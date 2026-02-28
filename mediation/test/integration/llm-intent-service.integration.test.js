import assert from 'node:assert/strict'
import test from 'node:test'

import { inferIntentWithLlm } from '../../src/providers/intent/llm-intent-service.js'

test('llm intent service: calls DeepSeek endpoint with max_tokens and compressed prompt', async () => {
  const originalFetch = globalThis.fetch
  const captured = {
    url: '',
    body: null,
  }

  globalThis.fetch = async (url, options = {}) => {
    captured.url = String(url || '')
    captured.body = JSON.parse(String(options.body || '{}'))
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent_class: 'shopping',
              intent_score: 0.83,
              preference_facets: [],
              constraints: { must_include: ['x'] },
              inference_trace: ['trace'],
            }),
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const longText = 'x'.repeat(600)
    const result = await inferIntentWithLlm({
      query: `我想买会员并对比价格 ${longText}`,
      answerText: `你可以比较几个平台 ${longText}`,
      locale: 'zh-CN',
      recentTurns: [
        { role: 'user', content: `u1_${longText}` },
        { role: 'assistant', content: `a1_${longText}` },
        { role: 'user', content: `u2_${longText}` },
      ],
      hints: {
        intent_class: 'shopping',
        blocked_topics: ['x'],
        should_not_pass: { huge: true },
      },
    }, {
      runtimeConfig: {
        deepseek: {
          apiKey: 'test-deepseek-key',
          model: 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com/chat/completions',
          intentMaxTokens: 96,
        },
      },
      timeoutMs: 800,
    })

    assert.equal(captured.url, 'https://api.deepseek.com/chat/completions')
    assert.equal(captured.body.model, 'deepseek-chat')
    assert.equal(captured.body.max_tokens, 96)
    assert.equal(captured.body.temperature, 0)
    assert.equal(captured.body.response_format?.type, 'json_object')

    const userPrompt = String(captured.body.messages?.[1]?.content || '')
    assert.equal(userPrompt.includes('Input:\n'), true)
    const payloadText = userPrompt.split('Input:\n')[1] || '{}'
    const promptPayload = JSON.parse(payloadText)
    assert.equal(String(promptPayload.query).length <= 320, true)
    assert.equal(String(promptPayload.answerText).length <= 240, true)
    assert.equal(Array.isArray(promptPayload.recent_turns), true)
    assert.equal(promptPayload.recent_turns.length <= 2, true)
    assert.equal(String(promptPayload.recent_turns[0]?.content || '').length <= 120, true)
    assert.equal(Boolean(promptPayload.client_hints?.should_not_pass), false)

    assert.equal(result.intent_class, 'shopping')
    assert.equal(result.intent_score, 0.83)
    assert.equal(Array.isArray(result.preference_facets), true)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'constraints'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'inference_trace'), false)
    assert.equal(result.fallbackUsed, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('llm intent service: returns missing_llm_config when deepseek key/model absent', async () => {
  const result = await inferIntentWithLlm({
    query: 'recommend a plan',
    answerText: '',
    locale: 'en-US',
  }, {
    runtimeConfig: {
      deepseek: {
        apiKey: '',
        model: '',
        baseUrl: 'https://api.deepseek.com/chat/completions',
        intentMaxTokens: 96,
      },
    },
    timeoutMs: 800,
  })

  assert.equal(result.fallbackUsed, true)
  assert.equal(result.fallbackReason, 'missing_llm_config')
})
