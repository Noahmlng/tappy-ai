function stableLabelKey(name, labels = {}) {
  const normalizedLabels = Object.entries(labels)
    .map(([key, value]) => [String(key), String(value)])
    .sort((a, b) => a[0].localeCompare(b[0]))

  const parts = normalizedLabels.map(([key, value]) => `${key}=${value}`)
  return parts.length === 0 ? name : `${name}|${parts.join(',')}`
}

function percentile(values = [], percentileValue = 0.5) {
  if (!Array.isArray(values) || values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const p = Math.max(0, Math.min(1, Number(percentileValue) || 0))
  const index = Math.ceil(sorted.length * p) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function createMetricsRegistry() {
  const counters = new Map()
  const gauges = new Map()
  const histograms = new Map()

  function incCounter(name, delta = 1, labels = {}) {
    const key = stableLabelKey(name, labels)
    const n = Number(delta)
    const safeDelta = Number.isFinite(n) ? n : 0
    const current = Number(counters.get(key) || 0)
    const next = current + safeDelta
    counters.set(key, next)
    return next
  }

  function setGauge(name, value, labels = {}) {
    const key = stableLabelKey(name, labels)
    const n = Number(value)
    const safeValue = Number.isFinite(n) ? n : 0
    gauges.set(key, safeValue)
    return safeValue
  }

  function observeHistogram(name, value, labels = {}) {
    const key = stableLabelKey(name, labels)
    const n = Number(value)
    if (!Number.isFinite(n)) return []

    if (!histograms.has(key)) {
      histograms.set(key, [])
    }

    const bucket = histograms.get(key)
    bucket.push(n)
    return [...bucket]
  }

  function getCounter(name, labels = {}) {
    const key = stableLabelKey(name, labels)
    return Number(counters.get(key) || 0)
  }

  function getGauge(name, labels = {}) {
    const key = stableLabelKey(name, labels)
    return Number(gauges.get(key) || 0)
  }

  function getHistogramSummary(name, labels = {}) {
    const key = stableLabelKey(name, labels)
    const bucket = Array.isArray(histograms.get(key)) ? histograms.get(key) : []
    if (bucket.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0
      }
    }

    return {
      count: bucket.length,
      min: Math.min(...bucket),
      max: Math.max(...bucket),
      p50: percentile(bucket, 0.5),
      p95: percentile(bucket, 0.95),
      p99: percentile(bucket, 0.99)
    }
  }

  function snapshot() {
    return {
      counters: Object.fromEntries(counters.entries()),
      gauges: Object.fromEntries(gauges.entries()),
      histograms: Object.fromEntries(
        Array.from(histograms.entries()).map(([key, values]) => [key, getHistogramSummary(key)])
      )
    }
  }

  return {
    getCounter,
    getGauge,
    getHistogramSummary,
    incCounter,
    observeHistogram,
    setGauge,
    snapshot
  }
}

export {
  createMetricsRegistry,
  percentile,
  stableLabelKey
}
