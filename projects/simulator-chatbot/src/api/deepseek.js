const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-reasoner'
const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || ''

function toDeepSeekMessages(messages = []) {
  return messages
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && msg.content)
    .map((msg) => ({ role: msg.role, content: msg.content }))
}

function extractDeltaText(parsedChunk) {
  const delta = parsedChunk?.choices?.[0]?.delta
  if (!delta) return ''

  if (typeof delta.content === 'string') {
    return delta.content
  }

  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }

  return ''
}

export async function sendMessageStream(messages, onMessage, onStart, onEnd, onError) {
  if (!DEEPSEEK_API_KEY) {
    onError('Missing API key. Set VITE_DEEPSEEK_API_KEY in .env.local')
    return
  }

  const payload = {
    model: DEEPSEEK_MODEL,
    messages: toDeepSeekMessages(messages),
    stream: true,
    temperature: 0.7,
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData?.error?.message || errorMessage
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errorMessage)
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('Response body is null')
    }

    let buffer = ''
    let hasStarted = false
    let hasEnded = false

    const finishOnce = () => {
      if (hasEnded) return
      hasEnded = true
      onEnd()
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          finishOnce()
          return
        }

        try {
          const parsed = JSON.parse(data)
          const deltaText = extractDeltaText(parsed)

          if (deltaText) {
            if (!hasStarted) {
              hasStarted = true
              onStart()
            }
            onMessage(deltaText)
          }
        } catch (error) {
          console.error('Failed to parse DeepSeek SSE chunk:', error)
        }
      }
    }

    finishOnce()
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Network error')
  }
}
