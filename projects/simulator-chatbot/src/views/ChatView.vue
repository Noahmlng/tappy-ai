<template>
  <div class="sim-shell">
    <div class="sim-backdrop" aria-hidden="true">
      <span class="sim-orb sim-orb-a"></span>
      <span class="sim-orb sim-orb-b"></span>
      <span class="sim-orb sim-orb-c"></span>
    </div>

    <aside :class="['sim-sidebar', isSidebarOpen ? 'is-open' : '']">
      <div class="sim-sidebar-head">
        <div class="sim-brand">
          <div class="sim-brand-mark">S</div>
          <div>
            <p class="sim-brand-title">Simulator Atelier</p>
            <p class="sim-brand-sub">Conversation Control Room</p>
          </div>
        </div>
        <button class="sim-icon-btn sim-mobile-only" @click="isSidebarOpen = false" aria-label="Close sidebar">
          <X :size="18" />
        </button>
      </div>

      <button @click="startNewChat" class="sim-new-chat-btn">
        <span class="sim-new-chat-copy">
          <Plus :size="14" />
          <span>Start New Thread</span>
        </span>
        <MessageSquare :size="14" />
      </button>

      <label class="sim-search-field">
        <Search :size="16" />
        <input v-model="historyQuery" type="text" placeholder="Search conversations" />
      </label>

      <div class="sim-sidebar-section-label">Conversation Archive</div>

      <div class="sim-session-list">
        <div
          v-for="session in filteredSessions"
          :key="session.id"
          :class="['sim-session-card', session.id === activeSessionId ? 'is-active' : '']"
        >
          <button @click="openSession(session.id)" class="sim-session-main">
            <p class="sim-session-title">{{ session.title }}</p>
            <p class="sim-session-time">{{ formatSessionTime(session.updatedAt) }}</p>
          </button>
          <button
            class="sim-session-delete"
            @click.stop="deleteSession(session.id)"
            aria-label="Delete chat"
            title="Delete chat"
          >
            <Trash2 :size="14" />
          </button>
        </div>

        <p v-if="filteredSessions.length === 0" class="sim-session-empty">No chat history yet.</p>
      </div>

      <div class="sim-sidebar-panels">
        <details class="sim-panel">
          <summary>System Prompt</summary>
          <div class="sim-panel-row">
            <button :disabled="!activeSession" @click="resetActiveSystemPrompt">Reset</button>
          </div>
          <textarea
            v-model="activeSystemPrompt"
            :disabled="!activeSession"
            rows="5"
            placeholder="Set a per-chat system prompt..."
          ></textarea>
          <p>Applied to every request in the active conversation.</p>
        </details>

        <details class="sim-panel">
          <summary>Turn Trace</summary>

          <p v-if="activeSessionTurnLogs.length === 0" class="sim-panel-empty">No turn logs yet.</p>

          <div v-else class="sim-trace-list">
            <details v-for="log in activeSessionTurnLogs" :key="log.turnId" class="sim-trace-card">
              <summary>
                <div class="sim-trace-head">
                  <span class="sim-trace-query">{{ log.userQuery }}</span>
                  <span :class="['sim-trace-badge', log.toolUsed ? 'is-tool' : '']">
                    {{ log.toolUsed ? 'Tool: YES' : 'Tool: NO' }}
                  </span>
                </div>
                <p>{{ formatTraceTime(log.startedAt) }}</p>
              </summary>

              <div class="sim-trace-body">
                <p>Retry count: {{ log.retryCount || 0 }}</p>
                <ul>
                  <li v-for="event in log.events" :key="event.id">
                    <span>{{ formatTraceTime(event.at) }}</span>
                    <span>·</span>
                    <span>{{ formatTraceEventType(event.type) }}</span>
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </details>

        <button class="sim-clear-history-btn" @click="clearHistory">Clear History</button>
      </div>
    </aside>

    <button
      v-if="isSidebarOpen"
      class="sim-sidebar-overlay"
      @click="isSidebarOpen = false"
      aria-label="Close sidebar overlay"
    ></button>

    <main class="sim-main">
      <header class="sim-topbar">
        <div class="sim-topbar-left">
          <button
            v-if="!isSidebarOpen"
            class="sim-icon-btn sim-open-sidebar-btn"
            @click="isSidebarOpen = true"
            aria-label="Open sidebar"
          >
            <Menu :size="18" />
          </button>
          <div class="sim-title-wrap">
            <p class="sim-kicker">ChatGPT 5.2</p>
          </div>
        </div>
        <button class="sim-pill-btn" @click="startNewChat">
          <span>Share</span>
        </button>
      </header>

      <div ref="scrollRef" class="sim-scroll-region">
        <section class="sim-hero" :class="{ 'is-hidden': hasStarted }">
          <p class="sim-hero-kicker">Simulator</p>
          <h2>Ready when you are.</h2>
          <p>Ask anything</p>
        </section>

        <section class="sim-thread" :class="{ 'is-visible': hasStarted }">
          <template v-for="msg in currentMessages" :key="msg.id">
            <article :class="['sim-turn', msg.role === 'user' ? 'is-user' : 'is-assistant']">
              <div class="sim-turn-inner">
                <div v-if="msg.role === 'assistant'" class="sim-avatar">AI</div>

                <div :class="['sim-message', msg.role === 'user' ? 'sim-message-user' : 'sim-message-assistant']">
                  <div v-if="msg.role === 'user'">
                    <template v-if="queryRewriteMessageId === msg.id">
                      <textarea
                        v-model="queryRewriteDraft"
                        rows="2"
                        class="sim-rewrite-input"
                        @keydown.esc.prevent="cancelQueryRewriteEdit"
                      ></textarea>
                      <div class="sim-message-actions sim-message-actions-right">
                        <button class="sim-ghost-btn" @click="cancelQueryRewriteEdit">Cancel</button>
                        <button
                          class="sim-solid-btn"
                          :disabled="!queryRewriteDraft.trim() || isLoading"
                          @click="submitQueryRewrite(msg)"
                        >
                          Rewrite & Run
                        </button>
                      </div>
                    </template>

                    <template v-else>
                      <div class="whitespace-pre-wrap">{{ msg.content }}</div>
                      <div class="sim-message-actions sim-message-actions-right">
                        <button class="sim-ghost-btn" :disabled="isLoading" @click="startQueryRewriteEdit(msg)">
                          <PenSquare :size="12" />
                          <span>Edit & Rewrite</span>
                        </button>
                      </div>
                    </template>
                  </div>

                  <div v-else>
                    <template v-if="msg.kind === 'tool'">
                      <div class="sim-tool-card">
                        <div class="sim-tool-head">
                          <span>Tool</span>
                          <span class="sim-tool-name">web_search</span>
                          <span class="sim-tool-state">{{ formatToolState(msg.toolState) }}</span>
                        </div>

                        <div v-if="msg.toolQuery" class="sim-tool-query">Query: "{{ msg.toolQuery }}"</div>

                        <div v-if="msg.toolState === 'running'" class="sim-tool-running">
                          <LoaderCircle :size="12" class="animate-spin" />
                          <span>Searching web...</span>
                        </div>

                        <div v-if="msg.toolState === 'error'" class="sim-tool-error">
                          {{ msg.toolError || 'Tool execution failed.' }}
                        </div>

                        <div v-if="msg.toolState === 'done' && msg.toolLatencyMs !== null" class="sim-tool-latency">
                          Finished in {{ msg.toolLatencyMs }} ms
                        </div>

                        <ul v-if="msg.toolResults?.length" class="sim-tool-results">
                          <li v-for="(result, idx) in msg.toolResults" :key="result.id || idx">
                            <a :href="result.url" target="_blank" rel="noopener noreferrer">
                              {{ idx + 1 }}. {{ result.title }}
                            </a>
                            <p>{{ result.snippet }}</p>
                            <p>{{ getHostLabel(result.url) }}</p>
                          </li>
                        </ul>
                      </div>
                    </template>

                    <template v-else-if="msg.status === 'reasoning' && !msg.content">
                      <div class="sim-reasoning">
                        <LoaderCircle :size="14" class="animate-spin" />
                        <span>Reasoning...</span>
                      </div>
                    </template>

                    <template v-if="msg.kind !== 'tool' && msg.content">
                      <MarkdownRenderer :key="msg.id" :content="msg.content" />
                      <span v-if="msg.status === 'streaming'" class="cursor-blink sim-stream-caret"></span>
                    </template>

                    <div
                      v-if="msg.kind !== 'tool' && msg.role === 'assistant' && msg.status === 'done' && msg.sourceUserContent"
                      class="sim-message-actions"
                    >
                      <button class="sim-ghost-btn" :disabled="isLoading" @click="handleRegenerate(msg)">
                        Regenerate
                      </button>
                      <span class="sim-retry-tag">Retry #{{ msg.retryCount }}</span>
                    </div>

                    <CitationSources
                      v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.sources?.length"
                      :sources="msg.sources"
                      @source-click="(source) => handleSourceClick(msg, source)"
                    />

                    <FollowUpSuggestions
                      v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.followUps?.length"
                      :items="msg.followUps"
                      :disabled="isLoading"
                      @select="handleFollowUpSelect"
                    />

                    <template
                      v-if="msg.kind !== 'tool' && msg.role === 'assistant' && msg.status === 'done' && msg.adCards?.length"
                    >
                      <AdCard
                        v-for="ad in msg.adCards"
                        :key="`${ad.placementId}:${ad.adId}`"
                        :ad="ad"
                        @ad-click="handleAdClick(msg, ad)"
                      />
                    </template>
                  </div>
                </div>
              </div>
            </article>
          </template>

          <div class="sim-thread-tail"></div>
        </section>
      </div>

      <footer class="sim-composer-zone" :class="{ 'is-live': hasStarted }">
        <div class="sim-composer-card">
          <textarea
            v-model="input"
            rows="1"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
            @keydown.enter.prevent="handleSend"
            placeholder="Ask anything..."
            class="sim-composer-input"
          ></textarea>

          <div class="sim-composer-footer">
            <p class="sim-composer-note">ChatGPT can make mistakes. Check important info.</p>
            <button
              @click="handleSend"
              :disabled="!input.trim() || isLoading"
              :class="['sim-send-btn', input.trim() && !isLoading ? 'is-active' : '']"
            >
              <ArrowUp :size="15" :stroke-width="2.5" />
            </button>
          </div>
        </div>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import {
  X,
  Plus,
  MessageSquare,
  Search,
  PenSquare,
  Trash2,
  Menu,
  ArrowUp,
  LoaderCircle,
} from 'lucide-vue-next'
import { sendMessageStream } from '../api/deepseek'
import { shouldUseWebSearchTool, runWebSearchTool, buildWebSearchContext } from '../api/webSearchTool'
import {
  getAdsPlacementIds,
  getAdsIntentScore,
  requestAdBid,
  reportInlineAdEvent,
  reportAdPostbackEvent,
} from '../api/adsSdk'
import CitationSources from '../components/CitationSources.vue'
import FollowUpSuggestions from '../components/FollowUpSuggestions.vue'
import MarkdownRenderer from '../components/MarkdownRenderer.vue'
import AdCard from '../components/AdCard.vue'

const STORAGE_KEY = 'chat_bot_history_v3'
const LEGACY_STORAGE_KEYS = ['chat_bot_history_v2', 'chat_bot_sessions_v1']
const TURN_LOG_STORAGE_KEY = 'chat_bot_turn_logs_v2'
const LEGACY_TURN_LOG_STORAGE_KEYS = ['chat_bot_turn_logs_v1']
const ADS_USER_ID_STORAGE_KEY = 'chat_ads_user_id_v1'
const MAX_SESSIONS = 50
const MAX_TURN_LOGS = 400
const TOOL_STATES = ['planning', 'running', 'done', 'error']
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Be accurate, concise, and explicit about uncertainty.'

const input = ref('')
const historyQuery = ref('')
const isSidebarOpen = ref(true)
const scrollRef = ref(null)
const isLoading = ref(false)
const isComposing = ref(false)
const queryRewriteMessageId = ref('')
const queryRewriteDraft = ref('')

const sessions = ref([])
const activeSessionId = ref('')
const turnLogs = ref([])

let persistTimer = null

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createSession(initialTitle = 'New Chat') {
  const now = Date.now()
  return {
    id: createId('session'),
    title: initialTitle,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeSourceItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!title || !url) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `source_${index}`,
    title,
    url,
    host: typeof raw.host === 'string' && raw.host ? raw.host : getHostFromUrl(url),
  }
}

function normalizeFollowUpItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null

  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : text
  if (!text || !prompt) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `follow_up_${index}`,
    text,
    prompt,
    sourceTurnId: typeof raw.sourceTurnId === 'string' ? raw.sourceTurnId : '',
  }
}

function normalizeToolResultItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? raw.title : ''
  const url = typeof raw.url === 'string' ? raw.url : ''
  const snippet = typeof raw.snippet === 'string' ? raw.snippet : ''
  if (!title || !url) return null

  return {
    id: typeof raw.id === 'string' ? raw.id : `tool_result_${index}`,
    title,
    url,
    snippet,
  }
}

function normalizeTurnEvent(raw, index) {
  if (!raw || typeof raw !== 'object') return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `event_${index}`,
    type: typeof raw.type === 'string' && raw.type ? raw.type : 'unknown_event',
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
  }
}

function normalizeAdCard(raw) {
  if (!raw || typeof raw !== 'object') return null

  const requestId = typeof raw.requestId === 'string' ? raw.requestId.trim() : ''
  const adId = typeof raw.adId === 'string' ? raw.adId.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!requestId || !adId || !url) return null

  const pricing = raw.pricing && typeof raw.pricing === 'object'
    ? {
        modelVersion: typeof raw.pricing.modelVersion === 'string' ? raw.pricing.modelVersion : 'cpa_mock_v2',
        triggerType: typeof raw.pricing.triggerType === 'string' ? raw.pricing.triggerType : '',
        targetRpmUsd: Number.isFinite(Number(raw.pricing.targetRpmUsd)) ? Number(raw.pricing.targetRpmUsd) : 0,
        ecpmUsd: Number.isFinite(Number(raw.pricing.ecpmUsd)) ? Number(raw.pricing.ecpmUsd) : 0,
        cpaUsd: Number.isFinite(Number(raw.pricing.cpaUsd)) ? Number(raw.pricing.cpaUsd) : 0,
        pClick: Number.isFinite(Number(raw.pricing.pClick)) ? Number(raw.pricing.pClick) : 0,
        pConv: Number.isFinite(Number(raw.pricing.pConv)) ? Number(raw.pricing.pConv) : 0,
        network: typeof raw.pricing.network === 'string' ? raw.pricing.network : '',
        rawSignal: raw.pricing.rawSignal && typeof raw.pricing.rawSignal === 'object'
          ? {
              rawBidValue: Number.isFinite(Number(raw.pricing.rawSignal.rawBidValue)) ? Number(raw.pricing.rawSignal.rawBidValue) : 0,
              rawUnit: typeof raw.pricing.rawSignal.rawUnit === 'string' ? raw.pricing.rawSignal.rawUnit : 'bid_value',
              normalizedFactor: Number.isFinite(Number(raw.pricing.rawSignal.normalizedFactor)) ? Number(raw.pricing.rawSignal.normalizedFactor) : 1,
            }
          : null,
      }
    : null

  return {
    requestId,
    placementId: typeof raw.placementId === 'string' && raw.placementId.trim() ? raw.placementId.trim() : 'chat_from_answer_v1',
    adId,
    advertiser: typeof raw.advertiser === 'string' && raw.advertiser.trim() ? raw.advertiser.trim() : 'Sponsored',
    headline: typeof raw.headline === 'string' && raw.headline.trim() ? raw.headline.trim() : 'Sponsored',
    description: typeof raw.description === 'string' ? raw.description : '',
    ctaText: typeof raw.ctaText === 'string' && raw.ctaText.trim() ? raw.ctaText.trim() : 'Learn More',
    url,
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
    dsp: typeof raw.dsp === 'string' ? raw.dsp : '',
    variant: typeof raw.variant === 'string' ? raw.variant : 'base',
    price: Number.isFinite(Number(raw.price)) ? Number(raw.price) : null,
    pricing,
    impressionReported: Boolean(raw.impressionReported),
    clickReported: Boolean(raw.clickReported),
    postbackReported: Boolean(raw.postbackReported),
    lastPostbackConversionId: typeof raw.lastPostbackConversionId === 'string' ? raw.lastPostbackConversionId : '',
  }
}

function normalizeAdCards(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeAdCard(item)).filter(Boolean)
  }
  const legacy = normalizeAdCard(raw)
  return legacy ? [legacy] : []
}

function normalizeMessage(raw) {
  if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) return null

  const toolState = TOOL_STATES.includes(raw.toolState) ? raw.toolState : 'done'
  const toolResults = Array.isArray(raw.toolResults)
    ? raw.toolResults.map((item, index) => normalizeToolResultItem(item, index)).filter(Boolean)
    : []
  const normalizedAdCards = normalizeAdCards(raw.adCards?.length ? raw.adCards : raw.adCard)

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('msg'),
    role: raw.role,
    kind: raw.kind === 'tool' && raw.role === 'assistant' ? 'tool' : 'chat',
    content: typeof raw.content === 'string' ? raw.content : '',
    status: raw.status === 'reasoning' || raw.status === 'streaming' ? raw.status : 'done',
    toolName: typeof raw.toolName === 'string' ? raw.toolName : '',
    toolState,
    toolQuery: typeof raw.toolQuery === 'string' ? raw.toolQuery : '',
    toolResults,
    toolLatencyMs: Number.isFinite(raw.toolLatencyMs) ? raw.toolLatencyMs : null,
    toolError: typeof raw.toolError === 'string' ? raw.toolError : '',
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((item, index) => normalizeSourceItem(item, index)).filter(Boolean)
      : [],
    sourceTurnId: typeof raw.sourceTurnId === 'string' ? raw.sourceTurnId : '',
    sourceUserContent: typeof raw.sourceUserContent === 'string' ? raw.sourceUserContent : '',
    retryCount: Number.isFinite(raw.retryCount) ? Math.max(0, raw.retryCount) : 0,
    followUps: Array.isArray(raw.followUps)
      ? raw.followUps.map((item, index) => normalizeFollowUpItem(item, index)).filter(Boolean)
      : [],
    adCards: normalizedAdCards,
    adCard: normalizeAdCard(raw.adCard) || normalizedAdCards[0] || null,
  }
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null

  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((item) => normalizeMessage(item)).filter(Boolean)
    : []

  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('session'),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'New Chat',
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    createdAt,
    updatedAt,
    messages,
  }
}

function normalizeTurnLog(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.turnId !== 'string' || !raw.turnId) return null
  if (typeof raw.sessionId !== 'string' || !raw.sessionId) return null

  const retryCount = Number.isFinite(raw.retryCount)
    ? Math.max(0, raw.retryCount)
    : Number.isFinite(raw?.events?.find?.((event) => event?.type === 'retry_policy_applied')?.payload?.retryCount)
      ? Math.max(0, raw.events.find((event) => event?.type === 'retry_policy_applied').payload.retryCount)
      : 0

  return {
    turnId: raw.turnId,
    traceId: typeof raw.traceId === 'string' ? raw.traceId : '',
    sessionId: raw.sessionId,
    userQuery: typeof raw.userQuery === 'string' ? raw.userQuery : '',
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : Date.now(),
    endedAt: Number.isFinite(raw.endedAt) ? raw.endedAt : null,
    toolUsed: Boolean(raw.toolUsed),
    retryCount,
    events: Array.isArray(raw.events)
      ? raw.events.map((event, index) => normalizeTurnEvent(event, index)).filter(Boolean)
      : [],
  }
}

function persistSessionsNow() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.value))
}

function persistTurnLogsNow() {
  localStorage.setItem(TURN_LOG_STORAGE_KEY, JSON.stringify(turnLogs.value))
}

function scheduleSaveSessions() {
  if (persistTimer) {
    clearTimeout(persistTimer)
  }

  persistTimer = setTimeout(() => {
    persistSessionsNow()
    persistTimer = null
  }, 120)
}

function ensureSessionExists() {
  if (sessions.value.length === 0) {
    const first = createSession()
    sessions.value = [first]
    activeSessionId.value = first.id
    persistSessionsNow()
  }
}

function loadSessions() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(key)
        if (legacyRaw) {
          raw = legacyRaw
          break
        }
      }
    }

    if (!raw) {
      ensureSessionExists()
      return
    }

    const parsed = JSON.parse(raw)
    const rawSessions = Array.isArray(parsed) ? parsed : []
    const normalized = rawSessions.map((item) => normalizeSession(item)).filter(Boolean)

    if (normalized.length === 0) {
      ensureSessionExists()
      return
    }

    normalized.sort((a, b) => b.updatedAt - a.updatedAt)
    sessions.value = normalized.slice(0, MAX_SESSIONS)
    activeSessionId.value = sessions.value[0].id
    persistSessionsNow()
  } catch (error) {
    console.error('Failed to load sessions:', error)
    sessions.value = []
    ensureSessionExists()
  }
}

function loadTurnLogs() {
  try {
    let raw = localStorage.getItem(TURN_LOG_STORAGE_KEY)
    if (!raw) {
      for (const key of LEGACY_TURN_LOG_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(key)
        if (legacyRaw) {
          raw = legacyRaw
          break
        }
      }
    }

    if (!raw) {
      turnLogs.value = []
      return
    }

    const parsed = JSON.parse(raw)
    const records = Array.isArray(parsed) ? parsed : []
    turnLogs.value = records.map((item) => normalizeTurnLog(item)).filter(Boolean).slice(0, MAX_TURN_LOGS)
    persistTurnLogsNow()
  } catch (error) {
    console.error('Failed to load turn logs:', error)
    turnLogs.value = []
  }
}

loadSessions()
loadTurnLogs()

const sortedSessions = computed(() => {
  return [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)
})

const filteredSessions = computed(() => {
  const keyword = historyQuery.value.trim().toLowerCase()
  if (!keyword) return sortedSessions.value

  return sortedSessions.value.filter((session) => {
    const titleMatch = session.title.toLowerCase().includes(keyword)
    if (titleMatch) return true

    return session.messages.some((msg) => msg.content.toLowerCase().includes(keyword))
  })
})

const activeSession = computed(() => {
  return sessions.value.find((session) => session.id === activeSessionId.value) || null
})
const activeSystemPrompt = computed({
  get() {
    if (!activeSession.value) return DEFAULT_SYSTEM_PROMPT
    return typeof activeSession.value.systemPrompt === 'string'
      ? activeSession.value.systemPrompt
      : DEFAULT_SYSTEM_PROMPT
  },
  set(nextValue) {
    if (!activeSession.value) return
    activeSession.value.systemPrompt = typeof nextValue === 'string'
      ? nextValue
      : DEFAULT_SYSTEM_PROMPT
    touchActiveSession()
    scheduleSaveSessions()
  },
})

const currentMessages = computed(() => activeSession.value?.messages || [])

const activeSessionTurnLogs = computed(() => {
  return turnLogs.value
    .filter((log) => log.sessionId === activeSessionId.value)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20)
})

const hasStarted = computed(() => currentMessages.value.length > 0)

async function scrollToBottom() {
  await nextTick()
  if (scrollRef.value) {
    scrollRef.value.scrollTo({
      top: scrollRef.value.scrollHeight,
      behavior: 'smooth',
    })
  }
}

watch(
  currentMessages,
  () => {
    if (hasStarted.value) {
      scrollToBottom()
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
})

function touchActiveSession() {
  const session = activeSession.value
  if (!session) return
  session.updatedAt = Date.now()
}

function formatTraceTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '--:--'
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTraceEventType(eventType) {
  return String(eventType || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function createTurnTrace(sessionId, userQuery, retryCount = 0) {
  const now = Date.now()
  return {
    turnId: createId('turn'),
    traceId: createId('trace'),
    sessionId,
    userQuery,
    startedAt: now,
    endedAt: null,
    toolUsed: false,
    retryCount,
    events: [],
  }
}

function appendTurnTraceEvent(turnTrace, type, payload = {}) {
  if (!turnTrace) return
  turnTrace.events.push({
    id: createId('event'),
    type,
    at: Date.now(),
    payload,
  })
}

function upsertTurnTrace(turnTrace) {
  if (!turnTrace || !turnTrace.turnId) return
  const index = turnLogs.value.findIndex((item) => item.turnId === turnTrace.turnId)
  if (index >= 0) {
    turnLogs.value[index] = { ...turnTrace }
  } else {
    turnLogs.value = [{ ...turnTrace }, ...turnLogs.value].slice(0, MAX_TURN_LOGS)
  }
  persistTurnLogsNow()
}

function updateTurnTrace(turnId, update) {
  const index = turnLogs.value.findIndex((item) => item.turnId === turnId)
  if (index < 0) return

  const current = turnLogs.value[index]
  const next = typeof update === 'function' ? update({ ...current }) : { ...current, ...update }
  turnLogs.value[index] = next
  persistTurnLogsNow()
}

function formatToolState(toolState) {
  if (toolState === 'planning') return 'Planned'
  if (toolState === 'running') return 'Running'
  if (toolState === 'error') return 'Failed'
  return 'Completed'
}

function getHostLabel(url) {
  return getHostFromUrl(url)
}

function normalizePromptKey(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function getLatestRetryCountForPrompt(session, prompt) {
  if (!session) return 0
  const targetKey = normalizePromptKey(prompt)
  if (!targetKey) return 0

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index]
    if (!message || message.role !== 'user') continue
    if (normalizePromptKey(message.content) !== targetKey) continue
    return Number.isFinite(message.retryCount) ? Math.max(0, message.retryCount) : 0
  }

  return 0
}

function buildModelMessages(messages, webSearchContext, systemPrompt = '') {
  const modelMessages = []

  const normalizedSystemPrompt = typeof systemPrompt === 'string'
    ? systemPrompt.trim()
    : ''
  if (normalizedSystemPrompt) {
    modelMessages.push({
      role: 'system',
      content: normalizedSystemPrompt,
    })
  }

  const chatMessages = messages
    .filter((msg) => {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return false
      if (msg.kind === 'tool') return false
      return typeof msg.content === 'string' && msg.content.trim().length > 0
    })
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
  modelMessages.push(...chatMessages)

  if (webSearchContext) {
    const contextContent = `Additional web search context for grounding:\n${webSearchContext}`
    const lastUserIndex = modelMessages
      .map((item, idx) => (item.role === 'user' ? idx : -1))
      .filter((idx) => idx >= 0)
      .pop()

    if (lastUserIndex !== undefined && lastUserIndex >= 0) {
      const existing = modelMessages[lastUserIndex]
      const combined = `${existing.content}\n\n${contextContent}`
      modelMessages[lastUserIndex] = {
        role: 'user',
        content: combined.trim(),
      }
    } else {
      modelMessages.push({
        role: 'user',
        content: contextContent,
      })
    }
  }

  return modelMessages
}

function extractTopicSeed(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 5)
    .join(' ')
}

function createFollowUpSuggestions(userContent, assistantContent, sourceTurnId = '') {
  const topicSeed = extractTopicSeed(userContent) || extractTopicSeed(assistantContent) || 'this topic'

  return [
    {
      id: createId('followup'),
      text: 'Can you break this into practical steps?',
      prompt: `Break down "${topicSeed}" into practical implementation steps.`,
      sourceTurnId,
    },
    {
      id: createId('followup'),
      text: 'What are the main trade-offs here?',
      prompt: `What are the main trade-offs and risks for "${topicSeed}"?`,
      sourceTurnId,
    },
    {
      id: createId('followup'),
      text: 'Can you give me one concrete example?',
      prompt: `Give one concrete example for "${topicSeed}" with expected output.`,
      sourceTurnId,
    },
  ]
}

function updateTitleFromFirstMessage(session, firstUserText) {
  if (!session) return
  if (session.title === 'New Chat' && firstUserText?.trim()) {
    const normalized = firstUserText.trim()
    session.title = normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized
  }
}

function formatSessionTime(timestamp) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function resetActiveSystemPrompt() {
  if (!activeSession.value) return
  activeSession.value.systemPrompt = DEFAULT_SYSTEM_PROMPT
  touchActiveSession()
  scheduleSaveSessions()
}

function openSession(sessionId) {
  cancelQueryRewriteEdit()
  activeSessionId.value = sessionId
  scrollToBottom()
}

function startNewChat() {
  cancelQueryRewriteEdit()
  const newSession = createSession()
  sessions.value = [newSession, ...sessions.value].slice(0, MAX_SESSIONS)
  activeSessionId.value = newSession.id
  historyQuery.value = ''
  persistSessionsNow()
}

function deleteSession(sessionId) {
  cancelQueryRewriteEdit()
  const nextSessions = sessions.value.filter((session) => session.id !== sessionId)
  sessions.value = nextSessions

  if (activeSessionId.value === sessionId) {
    if (sessions.value.length > 0) {
      activeSessionId.value = sortedSessions.value[0].id
    } else {
      ensureSessionExists()
    }
  }

  persistSessionsNow()
}

function clearHistory() {
  const confirmed = window.confirm('Clear all chat history?')
  if (!confirmed) return

  cancelQueryRewriteEdit()
  sessions.value = [createSession()]
  activeSessionId.value = sessions.value[0].id
  historyQuery.value = ''
  persistSessionsNow()
  turnLogs.value = []
  persistTurnLogsNow()
}

function getOrCreateAdsUserId() {
  try {
    const existing = localStorage.getItem(ADS_USER_ID_STORAGE_KEY)
    if (existing) return existing

    const nextId = createId('ads_user')
    localStorage.setItem(ADS_USER_ID_STORAGE_KEY, nextId)
    return nextId
  } catch {
    return createId('ads_user')
  }
}

function getBrowserLocale() {
  return typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language
    ? navigator.language
    : 'en-US'
}

function clamp01(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  if (numeric <= 0) return 0
  if (numeric >= 1) return 1
  return numeric
}

function hashToUnitInterval(seed = '') {
  let hash = 2166136261
  const text = String(seed || '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function buildStableConversionId(requestId, adId, turnId) {
  const seed = `${requestId}|${adId}|${turnId}`
  const unit = hashToUnitInterval(seed)
  const numeric = Math.floor(unit * 0xffffffff)
  return `conv_${numeric.toString(16).padStart(8, '0')}`
}

function shouldSimulateSuccessfulPostback(message, adCard) {
  const pConv = clamp01(adCard?.pricing?.pConv)
  if (pConv <= 0) return false
  const turnId = typeof message?.sourceTurnId === 'string' ? message.sourceTurnId : ''
  const sample = hashToUnitInterval(`${adCard?.requestId || ''}|${adCard?.adId || ''}|${turnId}`)
  return sample < pConv
}

function buildPostbackEventPayload(message, adCard, sessionId = activeSessionId.value) {
  if (!message || !adCard || !adCard.pricing) return null
  const cpaUsd = Number(adCard.pricing.cpaUsd)
  if (!Number.isFinite(cpaUsd) || cpaUsd <= 0) return null

  const turnId = typeof message.sourceTurnId === 'string' ? message.sourceTurnId : ''
  if (!turnId) return null

  return {
    requestId: adCard.requestId,
    sessionId,
    turnId,
    userId: getOrCreateAdsUserId(),
    placementId: adCard.placementId,
    adId: adCard.adId,
    conversionId: buildStableConversionId(adCard.requestId, adCard.adId, turnId),
    cpaUsd,
    postbackStatus: 'success',
    currency: 'USD',
  }
}

function buildInlineAdEventPayload(message, adCard, kind, sessionId = activeSessionId.value) {
  if (!adCard) return null

  const query = typeof message.sourceUserContent === 'string' ? message.sourceUserContent.trim() : ''
  const answerText = typeof message.content === 'string' ? message.content.trim() : ''
  if (!query || !answerText) return null

  return {
    requestId: adCard.requestId,
    sessionId,
    turnId: message.sourceTurnId,
    query,
    answerText,
    intentScore: getAdsIntentScore(query),
    locale: getBrowserLocale(),
    kind,
    placementId: adCard.placementId,
    adId: adCard.adId,
  }
}

function resolveSessionIdForMessage(message) {
  if (!message?.sourceTurnId) return activeSessionId.value
  const trace = turnLogs.value.find((item) => item.turnId === message.sourceTurnId)
  return trace?.sessionId || activeSessionId.value
}

async function fetchAndAttachAdForMessage({ session, turnTrace, assistantMessage }) {
  if (!session || !assistantMessage || assistantMessage.kind === 'tool') return

  const placementIds = getAdsPlacementIds()
  const attachedCards = []

  for (const placementId of placementIds) {
    appendTurnTraceEvent(turnTrace, 'ads_bid_requested', { placementId })
    upsertTurnTrace(turnTrace)

    const adBid = await requestAdBid({
      userId: getOrCreateAdsUserId(),
      chatId: session.id,
      placementId,
      messages: session.messages,
    })

    const stillExists = session.messages.some((message) => message.id === assistantMessage.id)
    if (!stillExists) return

    if (!adBid?.adCard) {
      appendTurnTraceEvent(turnTrace, 'ads_bid_empty', { placementId })
      upsertTurnTrace(turnTrace)
      continue
    }

    const adCard = { ...adBid.adCard }
    attachedCards.push(adCard)
    appendTurnTraceEvent(turnTrace, 'ads_bid_received', {
      requestId: adBid.requestId,
      placementId: adBid.placementId,
      adId: adCard.adId,
    })
    upsertTurnTrace(turnTrace)

    const impressionPayload = buildInlineAdEventPayload(assistantMessage, adCard, 'impression', session.id)
    const impressionReported = impressionPayload ? await reportInlineAdEvent(impressionPayload) : false
    adCard.impressionReported = impressionReported
    appendTurnTraceEvent(turnTrace, impressionReported ? 'ads_impression_reported' : 'ads_impression_skipped', {
      requestId: adBid.requestId,
      placementId: adBid.placementId,
      adId: adCard.adId,
    })
    upsertTurnTrace(turnTrace)
  }

  assistantMessage.adCards = attachedCards
  assistantMessage.adCard = attachedCards[0] || null
  touchActiveSession()
  scheduleSaveSessions()
}

function handleSourceClick(message, source) {
  if (!message?.sourceTurnId) return
  updateTurnTrace(message.sourceTurnId, (trace) => {
    const nextTrace = { ...trace }
    nextTrace.events = [
      ...trace.events,
      {
        id: createId('event'),
        type: 'source_clicked',
        at: Date.now(),
        payload: {
          sourceTitle: source?.title || '',
          sourceUrl: source?.url || '',
        },
      },
    ]
    return nextTrace
  })
}

async function handleAdClick(message, adCard) {
  if (!message || !adCard) return

  if (message.sourceTurnId) {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: 'ads_clicked',
          at: Date.now(),
          payload: {
            requestId: adCard.requestId,
            adId: adCard.adId,
            placementId: adCard.placementId,
          },
        },
      ]
      return nextTrace
    })
  }

  const resolvedSessionId = resolveSessionIdForMessage(message)
  const clickPayload = buildInlineAdEventPayload(message, adCard, 'click', resolvedSessionId)
  const clickReported = clickPayload ? await reportInlineAdEvent(clickPayload) : false
  const conversionSampleHit = clickReported
    && !adCard.postbackReported
    && shouldSimulateSuccessfulPostback(message, adCard)
  const postbackPayload = conversionSampleHit
    ? buildPostbackEventPayload(message, adCard, resolvedSessionId)
    : null
  const postbackReported = postbackPayload ? await reportAdPostbackEvent(postbackPayload) : false

  if (clickReported) {
    adCard.clickReported = true
  }
  if (postbackReported && postbackPayload) {
    adCard.postbackReported = true
    adCard.lastPostbackConversionId = postbackPayload.conversionId
  }
  if (clickReported || postbackReported) {
    touchActiveSession()
    scheduleSaveSessions()
  }

  if (message.sourceTurnId) {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: clickReported ? 'ads_click_reported' : 'ads_click_report_skipped',
          at: Date.now(),
          payload: {
            requestId: adCard.requestId,
            adId: adCard.adId,
            placementId: adCard.placementId,
          },
        },
      ]
      return nextTrace
    })
  }

  if (message.sourceTurnId) {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: postbackPayload ? 'ads_postback_triggered' : 'ads_postback_skipped',
          at: Date.now(),
          payload: {
            requestId: adCard.requestId,
            adId: adCard.adId,
            placementId: adCard.placementId,
            reason: postbackPayload
              ? 'conversion_sample_hit'
              : (conversionSampleHit ? 'payload_invalid' : 'conversion_sample_miss'),
          },
        },
      ]
      return nextTrace
    })
  }

  if (postbackPayload && message.sourceTurnId) {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: postbackReported ? 'ads_postback_reported' : 'ads_postback_report_skipped',
          at: Date.now(),
          payload: {
            requestId: adCard.requestId,
            adId: adCard.adId,
            placementId: adCard.placementId,
            conversionId: postbackPayload.conversionId,
            cpaUsd: postbackPayload.cpaUsd,
          },
        },
      ]
      return nextTrace
    })
  }
}

async function handleRegenerate(message) {
  if (!message?.sourceUserContent || isLoading.value) return

  const session = activeSession.value
  if (!session) return

  const latestRetryCount = getLatestRetryCountForPrompt(session, message.sourceUserContent)
  const nextRetryCount = Math.max(latestRetryCount, Number(message.retryCount) || 0) + 1

  if (message.sourceTurnId) {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: 'regenerate_requested',
          at: Date.now(),
          payload: {
            nextRetryCount,
          },
        },
      ]
      return nextTrace
    })
  }

  input.value = ''
  await handleSend({
    prefilledContent: message.sourceUserContent,
    retrySource: 'regenerate',
    forcedRetryCount: nextRetryCount,
  })
}

function startQueryRewriteEdit(message) {
  if (!message || message.role !== 'user' || isLoading.value) return
  queryRewriteMessageId.value = message.id
  queryRewriteDraft.value = String(message.content || '')
}

function cancelQueryRewriteEdit() {
  queryRewriteMessageId.value = ''
  queryRewriteDraft.value = ''
}

function collectTurnIdsFromMessages(messages = []) {
  const turnIdSet = new Set()
  for (const message of messages) {
    if (typeof message?.sourceTurnId === 'string' && message.sourceTurnId) {
      turnIdSet.add(message.sourceTurnId)
    }

    if (!Array.isArray(message?.followUps)) continue
    for (const followUp of message.followUps) {
      if (typeof followUp?.sourceTurnId === 'string' && followUp.sourceTurnId) {
        turnIdSet.add(followUp.sourceTurnId)
      }
    }
  }

  return Array.from(turnIdSet)
}

function pruneTurnLogsByIds(turnIds = []) {
  const target = new Set(turnIds.filter((id) => typeof id === 'string' && id))
  if (target.size === 0) return

  turnLogs.value = turnLogs.value.filter((log) => !target.has(log.turnId))
  persistTurnLogsNow()
}

async function submitQueryRewrite(message) {
  if (!message || message.role !== 'user' || isLoading.value) return

  const session = activeSession.value
  if (!session) return

  const rewrittenQuery = queryRewriteDraft.value.trim()
  if (!rewrittenQuery) return

  const targetIndex = session.messages.findIndex((item) => item.id === message.id)
  if (targetIndex < 0) return

  const originalQuery = String(message.content || '')
  const removedMessages = session.messages.slice(targetIndex)
  const removedTurnIds = collectTurnIdsFromMessages(removedMessages)

  session.messages = session.messages.slice(0, targetIndex)
  pruneTurnLogsByIds(removedTurnIds)
  touchActiveSession()
  scheduleSaveSessions()
  cancelQueryRewriteEdit()

  input.value = ''
  await handleSend({
    prefilledContent: rewrittenQuery,
    retrySource: 'query_rewrite',
    queryRewriteFrom: originalQuery,
    sourceMessageId: message.id,
  })
}

async function handleFollowUpSelect(item) {
  if (!item || !item.prompt || isLoading.value) return

  if (item.sourceTurnId) {
    updateTurnTrace(item.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: 'follow_up_clicked',
          at: Date.now(),
          payload: {
            text: item.text,
          },
        },
      ]
      return nextTrace
    })
  }

  input.value = ''
  await handleSend({
    prefilledContent: item.prompt,
    retrySource: 'follow_up',
  })
}

async function handleSend(options = {}) {
  const prefilledContent = typeof options.prefilledContent === 'string'
    ? options.prefilledContent.trim()
    : ''
  const userContent = prefilledContent || input.value.trim()

  if (!userContent || isLoading.value || isComposing.value) return

  const session = activeSession.value
  if (!session) return

  input.value = ''
  isLoading.value = true
  const sessionSystemPrompt = typeof session.systemPrompt === 'string'
    ? session.systemPrompt
    : DEFAULT_SYSTEM_PROMPT

  const latestRetryCount = getLatestRetryCountForPrompt(session, userContent)
  const retryCount = Number.isFinite(options.forcedRetryCount)
    ? Math.max(0, options.forcedRetryCount)
    : options.retrySource === 'regenerate'
      ? latestRetryCount + 1
      : 0

  const turnTrace = createTurnTrace(session.id, userContent, retryCount)
  appendTurnTraceEvent(turnTrace, 'turn_started', { query: userContent })
  appendTurnTraceEvent(turnTrace, 'system_prompt_applied', {
    isSet: Boolean(sessionSystemPrompt.trim()),
    length: sessionSystemPrompt.trim().length,
  })
  if (options.retrySource === 'query_rewrite') {
    appendTurnTraceEvent(turnTrace, 'query_rewrite_applied', {
      sourceMessageId: typeof options.sourceMessageId === 'string' ? options.sourceMessageId : '',
      fromQuery: typeof options.queryRewriteFrom === 'string' ? options.queryRewriteFrom : '',
      toQuery: userContent,
    })
  }
  if (retryCount > 0) {
    appendTurnTraceEvent(turnTrace, 'retry_policy_applied', { retryCount })
  }
  upsertTurnTrace(turnTrace)

  const userMessage = {
    id: createId('msg'),
    role: 'user',
    kind: 'chat',
    content: userContent,
    status: 'done',
    toolName: '',
    toolState: 'done',
    toolQuery: '',
    toolResults: [],
    toolLatencyMs: null,
    toolError: '',
    sources: [],
    sourceTurnId: '',
    sourceUserContent: userContent,
    retryCount,
    followUps: [],
    adCards: [],
    adCard: null,
  }

  session.messages.push(userMessage)
  updateTitleFromFirstMessage(session, userContent)
  touchActiveSession()
  scheduleSaveSessions()
  appendTurnTraceEvent(turnTrace, 'user_message_added')
  upsertTurnTrace(turnTrace)

  let webSearchContext = ''
  let assistantSources = []

  if (shouldUseWebSearchTool(userContent)) {
    turnTrace.toolUsed = true
    appendTurnTraceEvent(turnTrace, 'web_search_planned')
    upsertTurnTrace(turnTrace)

    const toolMessage = {
      id: createId('msg'),
      role: 'assistant',
      kind: 'tool',
      content: 'web_search planned',
      status: 'done',
      toolName: 'web_search',
      toolState: 'planning',
      toolQuery: userContent,
      toolResults: [],
      toolLatencyMs: null,
      toolError: '',
      sources: [],
      sourceTurnId: '',
      sourceUserContent: userContent,
      retryCount,
      followUps: [],
      adCards: [],
      adCard: null,
    }

    session.messages.push(toolMessage)
    touchActiveSession()
    scheduleSaveSessions()

    try {
      toolMessage.toolState = 'running'
      scheduleSaveSessions()
      appendTurnTraceEvent(turnTrace, 'web_search_called')
      upsertTurnTrace(turnTrace)

      const webSearchOutput = await runWebSearchTool(userContent)
      toolMessage.toolState = 'done'
      toolMessage.toolQuery = webSearchOutput.query
      toolMessage.toolResults = webSearchOutput.results
      toolMessage.toolLatencyMs = webSearchOutput.latencyMs
      toolMessage.content = `web_search returned ${webSearchOutput.results.length} results`

      assistantSources = webSearchOutput.results
        .map((result, index) => normalizeSourceItem(result, index))
        .filter(Boolean)

      appendTurnTraceEvent(turnTrace, 'web_search_succeeded', {
        resultCount: webSearchOutput.results.length,
        latencyMs: webSearchOutput.latencyMs,
      })

      if (options.retrySource === 'query_rewrite') {
        appendTurnTraceEvent(turnTrace, 'query_rewrite_recall_observed', {
          fromQuery: typeof options.queryRewriteFrom === 'string' ? options.queryRewriteFrom : '',
          toQuery: webSearchOutput.query,
          resultCount: webSearchOutput.results.length,
        })
      }

      appendTurnTraceEvent(turnTrace, 'citation_sources_prepared', {
        sourceCount: assistantSources.length,
      })
      upsertTurnTrace(turnTrace)

      webSearchContext = buildWebSearchContext(webSearchOutput.query, webSearchOutput.results)
    } catch (error) {
      toolMessage.toolState = 'error'
      toolMessage.toolError = error instanceof Error ? error.message : 'Tool execution failed'
      toolMessage.content = 'web_search failed'
      assistantSources = []
      appendTurnTraceEvent(turnTrace, 'web_search_failed', {
        error: toolMessage.toolError,
      })
      upsertTurnTrace(turnTrace)
    }

    touchActiveSession()
    scheduleSaveSessions()
  }

  const assistantMessage = {
    id: createId('msg'),
    role: 'assistant',
    kind: 'chat',
    content: '',
    status: 'reasoning',
    toolName: '',
    toolState: 'done',
    toolQuery: '',
    toolResults: [],
    toolLatencyMs: null,
    toolError: '',
    sources: [],
    sourceTurnId: turnTrace.turnId,
    sourceUserContent: userContent,
    retryCount,
    followUps: [],
    adCards: [],
    adCard: null,
  }

  session.messages.push(assistantMessage)
  touchActiveSession()
  scheduleSaveSessions()
  appendTurnTraceEvent(turnTrace, 'assistant_generation_started')
  upsertTurnTrace(turnTrace)

  const modelMessages = buildModelMessages(session.messages, webSearchContext, sessionSystemPrompt)

  await sendMessageStream(
    modelMessages,
    (text) => {
      if (assistantMessage.status === 'reasoning') {
        assistantMessage.status = 'streaming'
      }
      assistantMessage.content += text
      touchActiveSession()
      scheduleSaveSessions()
    },
    () => {
      assistantMessage.status = 'streaming'
      touchActiveSession()
      scheduleSaveSessions()
    },
    () => {
      assistantMessage.status = 'done'
      assistantMessage.sources = assistantSources
      assistantMessage.followUps = createFollowUpSuggestions(
        userContent,
        assistantMessage.content,
        turnTrace.turnId,
      )

      appendTurnTraceEvent(turnTrace, 'assistant_generation_completed', {
        responseLength: assistantMessage.content.length,
      })
      appendTurnTraceEvent(turnTrace, 'follow_up_generated', {
        count: assistantMessage.followUps.length,
      })
      appendTurnTraceEvent(turnTrace, 'citation_sources_rendered', {
        sourceCount: assistantMessage.sources.length,
      })

      turnTrace.endedAt = Date.now()
      upsertTurnTrace(turnTrace)
      touchActiveSession()
      scheduleSaveSessions()
      isLoading.value = false
      void fetchAndAttachAdForMessage({
        session,
        turnTrace,
        assistantMessage,
      })
    },
    (error) => {
      assistantMessage.status = 'done'
      assistantMessage.content = `Sorry, an error occurred: ${error}`
      assistantMessage.sources = []
      assistantMessage.followUps = []

      appendTurnTraceEvent(turnTrace, 'assistant_generation_failed', {
        error: assistantMessage.content,
      })
      turnTrace.endedAt = Date.now()
      upsertTurnTrace(turnTrace)
      touchActiveSession()
      scheduleSaveSessions()
      isLoading.value = false
      console.error('DeepSeek API Error:', error)
    },
  )
}
</script>

<style scoped>
.sim-shell {
  --sim-content-width: min(var(--content-max-width), 100%);
  --sim-edge-padding: clamp(12px, 2.2vw, 34px);

  position: relative;
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  isolation: isolate;
  color: var(--ink);
  font-family: var(--font-body);
  background: var(--paper);
}

.sim-shell::before {
  display: none;
}

.sim-backdrop {
  display: none;
}

.sim-orb {
  display: none;
}

.sim-orb-a {
  top: -80px;
  left: -56px;
  height: 220px;
  width: 220px;
  background: color-mix(in srgb, var(--accent-sea) 55%, white);
}

.sim-orb-b {
  top: 18%;
  right: -84px;
  height: 240px;
  width: 240px;
  animation-delay: -4s;
  background: color-mix(in srgb, var(--accent-gold) 56%, white);
}

.sim-orb-c {
  bottom: -92px;
  left: 42%;
  height: 200px;
  width: 200px;
  animation-delay: -8s;
  background: color-mix(in srgb, var(--accent-rust) 45%, white);
}

.sim-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 50;
  display: flex;
  width: var(--sidebar-width);
  flex-direction: column;
  gap: 12px;
  border-right: 1px solid var(--sidebar-border);
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  padding: var(--space-5) var(--space-4);
  transform: translateX(-110%);
  transition: transform var(--motion-slow) var(--ease-standard);
  box-shadow: none;
  backdrop-filter: none;
  will-change: transform;
}

.sim-sidebar.is-open {
  transform: translateX(0);
}

.sim-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sim-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sim-brand-mark {
  display: grid;
  height: 34px;
  width: 34px;
  place-items: center;
  border-radius: 11px;
  border: 1px solid var(--sidebar-border);
  background: #d8d8d8;
  color: #303030;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.sim-brand-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0.01em;
}

.sim-brand-sub {
  margin: 2px 0 0;
  color: var(--sidebar-muted);
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.sim-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  width: 36px;
  border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--paper) 76%, transparent);
  color: inherit;
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.sim-icon-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  border-color: color-mix(in srgb, var(--ink) 20%, transparent);
}

.sim-icon-btn:active {
  transform: translateY(0);
}

.sim-icon-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 2px;
}

.sim-mobile-only {
  color: var(--sidebar-muted);
  border-color: var(--sidebar-border);
  background: color-mix(in srgb, var(--sidebar-surface) 86%, transparent);
}

.sim-new-chat-btn {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--sidebar-border);
  border-radius: var(--radius-md);
  background: var(--sidebar-surface);
  color: var(--sidebar-text);
  padding: 11px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform var(--motion-base) var(--ease-standard),
    border-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard);
}

.sim-new-chat-btn:hover {
  transform: translateY(-1px);
  border-color: #cfcfcf;
  box-shadow: none;
}

.sim-new-chat-btn:active {
  transform: translateY(0);
}

.sim-new-chat-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 2px;
}

.sim-new-chat-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sim-search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--sidebar-border);
  border-radius: var(--radius-sm);
  background: #efefef;
  color: var(--sidebar-muted);
  padding: var(--space-2) var(--space-3);
}

.sim-search-field input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--sidebar-text);
  font-size: 13px;
}

.sim-search-field input::placeholder {
  color: var(--sidebar-muted);
}

.sim-search-field:focus-within {
  border-color: #c7c7c7;
  box-shadow: none;
}

.sim-sidebar-section-label {
  margin-top: 2px;
  color: var(--sidebar-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0 6px;
}

.sim-session-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 7px;
  display: grid;
  gap: 6px;
  align-content: start;
  grid-auto-rows: max-content;
  border: 1px solid #dbdbdb;
  border-radius: var(--radius-md);
  background: #ebebeb;
  box-shadow: none;
}

.sim-session-list::-webkit-scrollbar {
  width: 6px;
}

.sim-session-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--sidebar-muted) 40%, transparent);
}

.sim-session-card {
  position: relative;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
  overflow: hidden;
}

.sim-session-card:hover {
  border-color: #d2d2d2;
  background: #f2f2f2;
}

.sim-session-card.is-active {
  border-color: #cfcfcf;
  background: #f5f5f5;
}

.sim-session-card:focus-within .sim-session-delete {
  opacity: 1;
}

.sim-session-main {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 10px 34px 10px 11px;
  text-align: left;
  cursor: pointer;
}

.sim-session-main:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: -2px;
  border-radius: 10px;
}

.sim-session-title {
  margin: 0;
  font-size: 13px;
  font-weight: 530;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-session-time {
  margin: 5px 0 0;
  color: var(--sidebar-muted);
  font-size: 11px;
}

.sim-session-delete {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 24px;
  width: 24px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.sim-session-card:hover .sim-session-delete {
  opacity: 1;
}

.sim-session-delete:hover {
  color: var(--sidebar-text);
  background: color-mix(in srgb, var(--sidebar-border) 34%, transparent);
}

.sim-session-delete:focus-visible {
  opacity: 1;
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 1px;
}

.sim-session-empty {
  margin: 6px 4px 2px;
  color: var(--sidebar-muted);
  font-size: 12px;
  text-align: center;
}

.sim-sidebar-panels {
  display: grid;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid #d9d9d9;
}

.sim-panel {
  border: 1px solid #d9d9d9;
  border-radius: var(--radius-md);
  background: #ededed;
  padding: 10px;
}

.sim-panel summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  list-style: none;
  cursor: pointer;
  margin: 0;
  color: var(--sidebar-muted);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sim-panel summary::-webkit-details-marker {
  display: none;
}

.sim-panel summary::after {
  content: '+';
  font-size: 14px;
  line-height: 1;
  font-weight: 500;
  color: color-mix(in srgb, var(--sidebar-muted) 90%, #fff);
}

.sim-panel[open] summary::after {
  content: '−';
}

.sim-panel summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 56%, white);
  outline-offset: 2px;
  border-radius: 8px;
}

.sim-panel-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.sim-panel-row button,
.sim-clear-history-btn {
  border: 1px solid #d3d3d3;
  border-radius: 9px;
  background: #f2f2f2;
  color: var(--sidebar-muted);
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.sim-panel-row button {
  padding: 4px 8px;
}

.sim-panel-row button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sim-panel-row button:not(:disabled):hover,
.sim-clear-history-btn:hover {
  color: var(--sidebar-text);
  border-color: color-mix(in srgb, var(--accent-sea) 35%, white);
}

.sim-panel-row button:not(:disabled):active,
.sim-clear-history-btn:active {
  transform: translateY(0);
}

.sim-panel-row button:focus-visible,
.sim-clear-history-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 2px;
}

.sim-panel textarea {
  width: 100%;
  resize: vertical;
  margin-top: 10px;
  border-radius: 10px;
  border: 1px solid var(--sidebar-border);
  background: #f6f6f6;
  color: var(--sidebar-text);
  font-size: 12px;
  padding: 8px;
  outline: none;
}

.sim-panel textarea:focus {
  border-color: color-mix(in srgb, var(--accent-sea) 40%, white);
}

.sim-panel p {
  margin: 8px 0 0;
  font-size: 10px;
  color: var(--sidebar-muted);
}

.sim-panel-empty {
  margin-top: 10px;
}

.sim-trace-list {
  margin-top: 10px;
  max-height: 220px;
  overflow-y: auto;
  display: grid;
  gap: 6px;
}

.sim-trace-card {
  border: 1px solid #dadada;
  border-radius: 10px;
  background: #f2f2f2;
  padding: 8px;
}

.sim-trace-card summary {
  cursor: pointer;
}

.sim-trace-card summary::-webkit-details-marker {
  display: none;
}

.sim-trace-card summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 56%, white);
  outline-offset: 2px;
  border-radius: 8px;
}

.sim-trace-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sim-trace-query {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sidebar-text);
  font-size: 11px;
  font-weight: 560;
}

.sim-trace-badge {
  margin-left: auto;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 680;
  color: var(--sidebar-muted);
  background: color-mix(in srgb, var(--sidebar-border) 55%, transparent);
}

.sim-trace-badge.is-tool {
  color: #333;
  background: #e4e4e4;
}

.sim-trace-body {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--sidebar-border);
}

.sim-trace-body p {
  margin: 0 0 6px;
  font-size: 10px;
}

.sim-trace-body ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 3px;
}

.sim-trace-body li {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--sidebar-text);
}

.sim-clear-history-btn {
  width: 100%;
  padding: 8px 10px;
}

.sim-sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  border: 0;
  background: color-mix(in srgb, #000 18%, transparent);
}

.sim-sidebar-overlay:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 56%, white);
  outline-offset: -2px;
}

.sim-main {
  position: relative;
  z-index: 10;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.sim-topbar {
  position: sticky;
  top: 0;
  z-index: 22;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 8px clamp(8px, 1.4vw, 18px);
  border-bottom: 1px solid #e1e1e1;
  background: var(--paper);
  backdrop-filter: none;
  box-shadow: none;
}

.sim-topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sim-title-wrap {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  min-width: 0;
  border-radius: 8px;
  padding: 0 10px;
}

.sim-kicker {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0;
  text-transform: none;
  color: #222;
  font-weight: 560;
  line-height: 28px;
}

.sim-title {
  display: none;
}

.sim-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: #2f2f2f;
  font-size: 14px;
  font-weight: 600;
  min-height: 36px;
  padding: 0 10px;
  cursor: pointer;
  transition:
    transform var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.sim-pill-btn:hover {
  transform: none;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  text-decoration: underline;
}

.sim-pill-btn:active {
  transform: translateY(0);
}

.sim-pill-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 2px;
}

.sim-scroll-region {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 28px) var(--sim-edge-padding) var(--space-6);
  background: transparent;
}

.sim-hero {
  margin: clamp(90px, 20vh, 180px) auto 26px;
  width: var(--sim-content-width);
  position: relative;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
  transition:
    opacity var(--motion-slow) var(--ease-standard),
    transform var(--motion-slow) var(--ease-standard),
    max-height var(--motion-slow) var(--ease-standard),
    margin var(--motion-slow) var(--ease-standard),
    padding var(--motion-slow) var(--ease-standard);
  max-height: 260px;
  overflow: hidden;
  text-align: center;
}

.sim-hero::before {
  display: none;
}

.sim-hero > * {
  position: relative;
  z-index: 1;
}

.sim-hero.is-hidden {
  opacity: 0;
  transform: translateY(-14px) scale(0.98);
  max-height: 0;
  margin: 0 auto;
  padding-top: 0;
  padding-bottom: 0;
  border-width: 0;
}

.sim-hero-kicker {
  display: none;
}

.sim-hero h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(38px, 5.5vw, 56px);
  line-height: 1.08;
  letter-spacing: -0.02em;
  max-width: none;
  color: #222;
}

.sim-hero p {
  margin: 14px 0 0;
  max-width: none;
  color: #8a8a8a;
  font-size: 18px;
  line-height: 1.4;
}

.sim-thread {
  margin: 0 auto;
  width: var(--sim-content-width);
  padding-top: 4px;
  opacity: 0;
  transform: translateY(16px);
  pointer-events: none;
  transition: opacity var(--motion-slow) var(--ease-standard), transform var(--motion-slow) var(--ease-standard);
}

.sim-thread.is-visible {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.sim-turn {
  width: 100%;
  margin-bottom: var(--space-5);
  animation: rise-in var(--motion-slow) var(--ease-standard) both;
}

.sim-turn-inner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.sim-turn.is-user .sim-turn-inner {
  justify-content: flex-end;
}

.sim-avatar {
  display: none;
}

.sim-message {
  width: min(100%, 680px);
  border-radius: 18px;
  padding: 14px 16px 13px;
  font-size: 15px;
  line-height: 1.7;
  backdrop-filter: none;
}

.sim-message-user {
  max-width: min(76%, 640px);
  border: 1px solid #dddddd;
  background: #f3f3f3;
  box-shadow: none;
}

.sim-message-assistant {
  border: 1px solid #e2e2e2;
  background: #ececec;
  box-shadow: none;
}

.sim-rewrite-input {
  width: 100%;
  resize: vertical;
  border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, white 75%, var(--paper));
  color: var(--ink);
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.55;
  outline: none;
}

.sim-rewrite-input:focus {
  border-color: color-mix(in srgb, var(--accent-sea) 42%, transparent);
}

.sim-message-actions {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity var(--motion-base) var(--ease-standard), transform var(--motion-base) var(--ease-standard);
}

.sim-message-actions-right {
  justify-content: flex-end;
}

.sim-turn:hover .sim-message-actions,
.sim-message:focus-within .sim-message-actions {
  opacity: 1;
  transform: translateY(0);
}

@media (hover: none), (pointer: coarse) {
  .sim-message-actions {
    opacity: 1;
    transform: none;
  }
}

.sim-ghost-btn,
.sim-solid-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 650;
  padding: 7px 11px;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.sim-ghost-btn {
  border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
  background: color-mix(in srgb, var(--paper) 72%, white);
  color: var(--graphite);
}

.sim-ghost-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-sea) 34%, transparent);
  color: color-mix(in srgb, var(--ink) 78%, var(--accent-sea));
}

.sim-solid-btn {
  border: 1px solid color-mix(in srgb, var(--ink) 42%, transparent);
  background: color-mix(in srgb, var(--ink) 92%, #13372b);
  color: #f6f7f2;
}

.sim-solid-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--ink) 86%, #1f4f3f);
}

.sim-ghost-btn:active:not(:disabled),
.sim-solid-btn:active:not(:disabled) {
  transform: translateY(0);
}

.sim-ghost-btn:focus-visible,
.sim-solid-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 2px;
}

.sim-ghost-btn:disabled,
.sim-solid-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sim-tool-card {
  border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  border-radius: var(--radius-lg);
  background: #f0f0f0;
  padding: 12px;
}

.sim-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--graphite);
}

.sim-tool-name {
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 62%, white);
  padding: 3px 8px;
  font-weight: 700;
}

.sim-tool-state {
  margin-left: auto;
  font-size: 11px;
  letter-spacing: normal;
  text-transform: none;
  font-weight: 600;
}

.sim-tool-query,
.sim-tool-latency,
.sim-tool-error {
  margin-top: 10px;
  font-size: 12px;
}

.sim-tool-running {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--graphite);
}

.sim-tool-error {
  color: #a6332a;
}

.sim-tool-results {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.sim-tool-results li {
  border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, white 84%, var(--paper));
  padding: 9px 10px;
}

.sim-tool-results a {
  color: color-mix(in srgb, var(--accent-sea) 92%, black);
  font-weight: 600;
  text-decoration: none;
}

.sim-tool-results a:hover {
  text-decoration: underline;
}

.sim-tool-results a:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 56%, white);
  outline-offset: 2px;
  border-radius: 6px;
}

.sim-tool-results p {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--graphite);
}

.sim-reasoning {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--graphite);
}

.sim-stream-caret {
  margin-left: 2px;
  width: 2px;
  height: 19px;
  display: inline-block;
  vertical-align: middle;
  background: color-mix(in srgb, var(--ink) 80%, var(--accent-sea));
}

.sim-retry-tag {
  color: var(--pencil);
  font-size: 11px;
  letter-spacing: 0.02em;
}

.sim-thread-tail {
  height: 14px;
}

.sim-composer-zone {
  position: sticky;
  bottom: 0;
  z-index: 24;
  padding: var(--space-2) var(--sim-edge-padding) 32px;
  background: transparent;
  backdrop-filter: none;
}

.sim-composer-zone.is-live {
  background: transparent;
}

.sim-composer-card {
  position: relative;
  width: var(--sim-content-width);
  margin: 0 auto;
  border: 1px solid #dadada;
  border-radius: 28px;
  background: #fff;
  box-shadow: none;
  min-height: 56px;
  height: 56px;
  padding: 10px 56px 10px 16px;
  overflow: visible;
  transition:
    border-color var(--motion-base) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard);
}

.sim-composer-card:focus-within {
  border-color: #cfcfcf;
  box-shadow: none;
}

.sim-composer-input {
  width: 100%;
  min-height: 24px;
  height: 24px;
  max-height: 180px;
  resize: none;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 16px;
  line-height: 24px;
  padding: 0;
  outline: none;
}

.sim-composer-input::placeholder {
  color: color-mix(in srgb, var(--pencil) 86%, transparent);
}

.sim-composer-footer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.sim-composer-note {
  margin: 0;
  position: absolute;
  left: 50%;
  bottom: -24px;
  transform: translateX(-50%);
  white-space: nowrap;
  color: var(--pencil);
  font-size: 12px;
  line-height: 16px;
}

.sim-send-btn {
  position: absolute;
  right: 10px;
  top: 10px;
  pointer-events: auto;
  display: grid;
  place-items: center;
  height: 36px;
  width: 36px;
  border: 1px solid #000;
  border-radius: 999px;
  background: #000;
  color: #fff;
  transition:
    transform var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.sim-send-btn.is-active {
  background: #000;
  border-color: #000;
  color: #fff;
  cursor: pointer;
  box-shadow: none;
}

.sim-send-btn.is-active:hover {
  transform: none;
}

.sim-send-btn.is-active:active {
  transform: none;
}

.sim-send-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 58%, white);
  outline-offset: 2px;
}

.sim-send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

@media (min-width: 1100px) {
  .sim-sidebar {
    position: relative;
    transform: none;
    z-index: 20;
  }

  .sim-mobile-only {
    display: none;
  }

  .sim-open-sidebar-btn {
    display: none;
  }

  .sim-sidebar-overlay {
    display: none;
  }
}

@media (max-width: 1099px) {
  .sim-sidebar {
    width: min(92vw, 360px);
  }

  .sim-topbar {
    padding-inline: 14px;
  }

  .sim-kicker {
    font-size: 18px;
    line-height: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sim-orb,
  .sim-turn,
  .sim-hero,
  .sim-thread,
  .sim-pill-btn,
  .sim-new-chat-btn,
  .sim-send-btn,
  .sim-icon-btn {
    animation: none !important;
    transition: none !important;
  }
}

@media (max-width: 720px) {
  .sim-scroll-region {
    padding-inline: 16px;
  }

  .sim-hero {
    border-radius: var(--radius-xl);
    padding: 18px 17px;
    margin-top: 12px;
  }

  .sim-hero h2 {
    font-size: clamp(25px, 9vw, 34px);
  }

  .sim-message {
    width: 100%;
    max-width: 100%;
  }

  .sim-message-user {
    max-width: 94%;
  }

  .sim-composer-zone {
    padding-inline: 16px;
    padding-bottom: 16px;
  }

  .sim-pill-btn {
    height: 34px;
    width: 34px;
    border-radius: var(--radius-sm);
    padding: 0;
    justify-content: center;
  }

  .sim-pill-btn span {
    display: none;
  }

  .sim-composer-note {
    display: none;
  }
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(10px, -12px, 0);
  }
}
</style>
