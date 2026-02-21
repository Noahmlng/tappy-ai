import net from 'node:net'

function readEnv(name, { required = false } = {}) {
  const value = String(process.env[name] || '').trim()
  if (!value && required) {
    return {
      ok: false,
      value: '',
      reason: `missing env: ${name}`
    }
  }
  return {
    ok: true,
    value,
    reason: ''
  }
}

function mask(value, visible = 4) {
  const text = String(value || '')
  if (!text) return '<empty>'
  if (text.length <= visible) return '*'.repeat(text.length)
  return `${'*'.repeat(text.length - visible)}${text.slice(-visible)}`
}

function parseNatsAddress(natsUrl) {
  try {
    const parsed = new URL(natsUrl)
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 4222)
    }
  } catch (error) {
    return {
      host: '',
      port: 0
    }
  }
}

function tcpPing({ host, port, timeoutMs = 3000 }) {
  return new Promise((resolve) => {
    if (!host || !Number.isInteger(port) || port <= 0) {
      resolve({ ok: false, reason: 'invalid host/port' })
      return
    }

    const socket = new net.Socket()
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ ok: true }))
    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }))
    socket.once('error', (error) => finish({ ok: false, reason: error.message }))

    socket.connect(port, host)
  })
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  let data = null
  try {
    data = await response.json()
  } catch (error) {
    data = null
  }
  return {
    ok: response.ok,
    status: response.status,
    data
  }
}

async function checkDoppler() {
  const tokenEnv = readEnv('DOPPLER_TOKEN', { required: true })
  const projectEnv = readEnv('DOPPLER_PROJECT', { required: true })
  const configEnv = readEnv('DOPPLER_CONFIG', { required: true })

  if (!tokenEnv.ok || !projectEnv.ok || !configEnv.ok) {
    return {
      ok: false,
      reason: [tokenEnv.reason, projectEnv.reason, configEnv.reason].filter(Boolean).join('; ')
    }
  }

  const token = tokenEnv.value
  const project = projectEnv.value
  const config = configEnv.value
  const url = `https://api.doppler.com/v3/configs/config?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`

  const bearerResult = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  })

  if (bearerResult.ok) {
    return {
      ok: true,
      mode: 'bearer',
      project,
      config,
      status: bearerResult.status
    }
  }

  const basicToken = Buffer.from(`${token}:`).toString('base64')
  const basicResult = await fetchJson(url, {
    headers: {
      Authorization: `Basic ${basicToken}`,
      Accept: 'application/json'
    }
  })

  if (!basicResult.ok) {
    return {
      ok: false,
      status: basicResult.status,
      reason: 'doppler api auth failed'
    }
  }

  return {
    ok: true,
    mode: 'basic',
    project,
    config,
    status: basicResult.status
  }
}

async function checkGrafana() {
  const grafanaUrlEnv = readEnv('GRAFANA_URL', { required: true })
  const tokenEnv = readEnv('GRAFANA_SERVICE_ACCOUNT_TOKEN', { required: true })
  if (!grafanaUrlEnv.ok || !tokenEnv.ok) {
    return {
      ok: false,
      reason: [grafanaUrlEnv.reason, tokenEnv.reason].filter(Boolean).join('; ')
    }
  }

  const grafanaUrl = grafanaUrlEnv.value
  const token = tokenEnv.value
  const url = `${grafanaUrl.replace(/\/$/, '')}/api/org`

  const result = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  })

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      reason: 'grafana api auth failed'
    }
  }

  return {
    ok: true,
    status: result.status,
    orgId: result.data?.id || null,
    orgName: result.data?.name || null
  }
}

async function checkSynadia() {
  const natsUrlEnv = readEnv('NATS_URL', { required: true })
  const publicKeyEnv = readEnv('SYNADIA_CLOUD_USER_PUBLIC_KEY', { required: true })
  const seed = readEnv('SYNADIA_CLOUD_USER_SEED').value
  const creds = readEnv('SYNADIA_CLOUD_CREDS').value
  const credsFile = readEnv('SYNADIA_CLOUD_CREDS_FILE').value
  const natsUser = readEnv('NATS_USER').value
  const natsPassword = readEnv('NATS_PASSWORD').value

  const hasAuthMaterial = Boolean(seed || creds || credsFile || (natsUser && natsPassword))
  const requiredErrors = [natsUrlEnv.reason, publicKeyEnv.reason].filter(Boolean)

  if (!hasAuthMaterial) {
    requiredErrors.push('missing Synadia auth material (need seed/creds/user+password)')
  }

  if (requiredErrors.length > 0) {
    return {
      ok: false,
      reason: requiredErrors.join('; ')
    }
  }

  const natsUrl = natsUrlEnv.value
  const publicKey = publicKeyEnv.value

  const address = parseNatsAddress(natsUrl)
  const tcpResult = await tcpPing({ host: address.host, port: address.port })

  if (!tcpResult.ok) {
    return {
      ok: false,
      reason: `cannot reach nats endpoint: ${tcpResult.reason}`,
      endpoint: `${address.host}:${address.port}`
    }
  }

  return {
    ok: true,
    endpoint: `${address.host}:${address.port}`,
    publicKeyTail: mask(publicKey)
  }
}

async function main() {
  const checks = {
    doppler: await checkDoppler(),
    grafana: await checkGrafana(),
    synadia: await checkSynadia()
  }

  const failed = Object.entries(checks)
    .filter(([, result]) => !result.ok)
    .map(([name]) => name)

  for (const [name, result] of Object.entries(checks)) {
    if (result.ok) {
      console.log(`[managed-check] ${name}: ok`) 
    } else {
      console.error(`[managed-check] ${name}: fail (${result.reason || `status=${result.status}`})`)
    }
  }

  if (failed.length > 0) {
    console.error(`[managed-check] failed services: ${failed.join(', ')}`)
    process.exit(1)
  }

  console.log('[managed-check] all managed services are reachable and authorized.')
}

main().catch((error) => {
  console.error(`[managed-check] fatal: ${error.message}`)
  process.exit(1)
})
