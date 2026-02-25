import { describe, it, expect } from 'vitest'
import {
  normalizeSourceItem,
  normalizeMessage,
  normalizeSession,
  normalizeTurnLog,
  getLatestRetryCountForPrompt,
  buildModelMessages,
  hashToUnitInterval,
  buildStableConversionId,
  shouldSimulateSuccessfulPostback,
} from '../utils/chatRuntime'

describe('chatRuntime', () => {
  it('normalizes source host from url', () => {
    const source = normalizeSourceItem(
      {
        title: 'OpenAI Docs',
        url: 'https://www.openai.com/docs',
      },
      0,
    )

    expect(source).toEqual({
      id: 'source_0',
      title: 'OpenAI Docs',
      url: 'https://www.openai.com/docs',
      host: 'openai.com',
    })
  })

  it('normalizes messages with defaults and tool state fallback', () => {
    const message = normalizeMessage(
      {
        role: 'assistant',
        kind: 'tool',
        content: 'done',
        toolState: 'unknown',
      },
      {
        createId: () => 'msg_1',
      },
    )

    expect(message.id).toBe('msg_1')
    expect(message.toolState).toBe('done')
    expect(message.kind).toBe('tool')
    expect(message.followUps).toEqual([])
  })

  it('normalizes sessions and applies default system prompt', () => {
    const session = normalizeSession(
      {
        title: '  ',
        messages: [{ role: 'user', content: 'hello' }],
      },
      {
        createId: (prefix) => `${prefix}_id`,
        nowFn: () => 123,
        defaultSystemPrompt: 'sys',
      },
    )

    expect(session.id).toBe('session_id')
    expect(session.title).toBe('New Chat')
    expect(session.systemPrompt).toBe('sys')
    expect(session.createdAt).toBe(123)
    expect(session.messages).toHaveLength(1)
  })

  it('normalizes turn logs and derives retry count from events', () => {
    const log = normalizeTurnLog(
      {
        turnId: 'turn_1',
        sessionId: 'session_1',
        events: [
          {
            type: 'retry_policy_applied',
            payload: { retryCount: 2 },
          },
        ],
      },
      { nowFn: () => 456 },
    )

    expect(log.retryCount).toBe(2)
    expect(log.startedAt).toBe(456)
    expect(log.events).toHaveLength(1)
  })

  it('gets latest retry count from normalized user prompts', () => {
    const count = getLatestRetryCountForPrompt(
      {
        messages: [
          { role: 'user', content: 'hello world', retryCount: 1 },
          { role: 'assistant', content: 'response' },
          { role: 'user', content: '  HELLO   WORLD  ', retryCount: 3 },
        ],
      },
      'hello world',
    )

    expect(count).toBe(3)
  })

  it('builds model messages and injects web context into last user message', () => {
    const messages = buildModelMessages(
      [
        { role: 'user', content: 'A', kind: 'chat' },
        { role: 'assistant', content: 'B', kind: 'chat' },
        { role: 'user', content: 'C', kind: 'chat' },
      ],
      'ctx',
      'sys',
    )

    expect(messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(messages.at(-1).role).toBe('user')
    expect(messages.at(-1).content).toContain('Additional web search context for grounding')
    expect(messages.at(-1).content).toContain('ctx')
  })

  it('generates deterministic hash and conversion id', () => {
    const sample = hashToUnitInterval('seed')
    expect(sample).toBeGreaterThanOrEqual(0)
    expect(sample).toBeLessThanOrEqual(1)

    const convA = buildStableConversionId('r', 'a', 't')
    const convB = buildStableConversionId('r', 'a', 't')
    expect(convA).toBe(convB)
    expect(convA.startsWith('conv_')).toBe(true)
  })

  it('simulates postback conversion by pConv threshold', () => {
    const message = { sourceTurnId: 'turn_1' }
    const adCard = {
      requestId: 'req',
      adId: 'ad',
      pricing: { pConv: 1 },
    }

    expect(shouldSimulateSuccessfulPostback(message, adCard)).toBe(true)
    expect(
      shouldSimulateSuccessfulPostback(message, {
        ...adCard,
        pricing: { pConv: 0 },
      }),
    ).toBe(false)
  })
})
