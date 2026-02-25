<template>
  <div class="chat-shell">
    <aside :class="['chat-sidebar', isSidebarOpen ? 'is-open' : '']">
      <div class="chat-sidebar-top">
        <div class="chat-sidebar-head">
          <button class="chat-icon-btn chat-mobile-only" @click="isSidebarOpen = false" aria-label="Close sidebar">
            <X :size="18" />
          </button>
          <button class="chat-new-btn" @click="startNewChat" type="button">
            <Plus :size="14" />
            <span>New chat</span>
          </button>
        </div>

        <label class="chat-search-field">
          <Search :size="16" />
          <input v-model="historyQuery" type="text" placeholder="Search chats" />
        </label>
      </div>

      <section class="chat-session-section">
        <p class="chat-section-label">Chats</p>
        <div class="chat-session-list">
          <div
            v-for="session in filteredSessions"
            :key="session.id"
            :class="['chat-session-item', session.id === activeSessionId ? 'is-active' : '']"
          >
            <button @click="openSession(session.id)" class="chat-session-main" type="button">
              <span class="chat-session-title">{{ session.title }}</span>
              <span class="chat-session-time">{{ formatSessionTime(session.updatedAt) }}</span>
            </button>
            <button
              class="chat-session-delete"
              type="button"
              @click.stop="deleteSession(session.id)"
              :disabled="isLoading"
              aria-label="Delete chat"
            >
              <Trash2 :size="14" />
            </button>
          </div>

          <p v-if="filteredSessions.length === 0" class="chat-session-empty">No chat history yet.</p>
        </div>
      </section>

      <footer class="chat-sidebar-footer">
        <button class="chat-clear-btn" type="button" @click="clearHistory" :disabled="isLoading || sessions.length === 0">
          Clear conversations
        </button>
      </footer>
    </aside>

    <button
      v-if="isSidebarOpen && !isDesktopLayout"
      class="chat-sidebar-overlay"
      @click="isSidebarOpen = false"
      aria-label="Close sidebar overlay"
      type="button"
    ></button>

    <main class="chat-main">
      <header class="chat-topbar">
        <div class="chat-topbar-left">
          <button
            v-if="!isDesktopLayout"
            class="chat-icon-btn"
            @click="isSidebarOpen = true"
            aria-label="Open sidebar"
            type="button"
          >
            <Menu :size="18" />
          </button>
          <h1 class="chat-title">ChatGPT</h1>
        </div>
        <button class="chat-new-inline-btn" @click="startNewChat" aria-label="Start new chat" type="button">
          <Plus :size="17" />
        </button>
      </header>

      <div ref="scrollRef" class="chat-scroll-region">
        <section class="chat-hero" :class="{ 'is-hidden': hasStarted }">
          <h2>Ready when you are.</h2>
          <p>Ask anything</p>

          <div v-if="!hasStarted && isDesktopLayout" class="chat-home-composer">
            <div class="chat-composer-card chat-composer-home">
              <textarea
                ref="homeComposerRef"
                v-model="input"
                rows="1"
                @compositionstart="isComposing = true"
                @compositionend="isComposing = false"
                @input="handleComposerInput"
                @keydown="handleComposerKeydown"
                placeholder="Ask anything"
                class="chat-composer-input"
              ></textarea>

              <div class="chat-composer-footer">
                <p class="chat-composer-note">ChatGPT can make mistakes. Check important info.</p>
                <button
                  @click="handleSend"
                  :disabled="!input.trim() || isLoading"
                  :class="['chat-send-btn', input.trim() && !isLoading ? 'is-active' : '']"
                  type="button"
                  aria-label="Send message"
                >
                  <ArrowUp :size="15" :stroke-width="2.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="chat-thread" :class="{ 'is-visible': hasStarted }">
          <template v-for="msg in currentMessages" :key="msg.id">
            <article :class="['chat-turn', msg.role === 'user' ? 'is-user' : 'is-assistant']">
              <div class="chat-turn-inner">
                <div :class="['chat-message', msg.role === 'user' ? 'chat-message-user' : 'chat-message-assistant']">
                  <div v-if="msg.role === 'user'">
                    <template v-if="queryRewriteMessageId === msg.id">
                      <textarea
                        v-model="queryRewriteDraft"
                        rows="2"
                        class="chat-rewrite-input"
                        @keydown.esc.prevent="cancelQueryRewriteEdit"
                      ></textarea>
                      <div class="chat-message-actions chat-message-actions-right">
                        <button class="chat-btn-ghost" @click="cancelQueryRewriteEdit" type="button">Cancel</button>
                        <button
                          class="chat-btn-solid"
                          :disabled="!queryRewriteDraft.trim() || isLoading"
                          @click="submitQueryRewrite(msg)"
                          type="button"
                        >
                          Rewrite & Run
                        </button>
                      </div>
                    </template>

                    <template v-else>
                      <div class="whitespace-pre-wrap">{{ msg.content }}</div>
                      <div class="chat-message-actions chat-message-actions-right">
                        <button class="chat-btn-ghost" :disabled="isLoading" @click="startQueryRewriteEdit(msg)" type="button">
                          <PenSquare :size="12" />
                          <span>Edit & Rewrite</span>
                        </button>
                      </div>
                    </template>
                  </div>

                  <div v-else>
                    <template v-if="msg.kind === 'tool'">
                      <div class="chat-tool-card">
                        <div class="chat-tool-head">
                          <span>Tool</span>
                          <span class="chat-tool-name">web_search</span>
                          <span class="chat-tool-state">{{ formatToolState(msg.toolState) }}</span>
                        </div>

                        <div v-if="msg.toolQuery" class="chat-tool-query">Query: "{{ msg.toolQuery }}"</div>

                        <div v-if="msg.toolState === 'running'" class="chat-tool-running">
                          <LoaderCircle :size="12" class="animate-spin" />
                          <span>Searching web...</span>
                        </div>

                        <div v-if="msg.toolState === 'error'" class="chat-tool-error">
                          {{ msg.toolError || 'Tool execution failed.' }}
                        </div>

                        <div v-if="msg.toolState === 'done' && msg.toolLatencyMs !== null" class="chat-tool-latency">
                          Finished in {{ msg.toolLatencyMs }} ms
                        </div>

                        <ul v-if="msg.toolResults?.length" class="chat-tool-results">
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
                      <div class="chat-reasoning">
                        <LoaderCircle :size="14" class="animate-spin" />
                        <span>Reasoning...</span>
                      </div>
                    </template>

                    <template v-if="msg.kind !== 'tool' && msg.content">
                      <MarkdownRenderer :key="msg.id" :content="msg.content" />
                      <span v-if="msg.status === 'streaming'" class="cursor-blink chat-stream-caret"></span>
                    </template>

                    <div
                      v-if="msg.kind !== 'tool' && msg.role === 'assistant' && msg.status === 'done' && msg.sourceUserContent"
                      class="chat-message-actions"
                    >
                      <button class="chat-btn-ghost" :disabled="isLoading" @click="handleRegenerate(msg)" type="button">
                        Regenerate
                      </button>
                      <span class="chat-retry-tag">Retry #{{ msg.retryCount }}</span>
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

          <div class="chat-thread-tail"></div>
        </section>
      </div>

      <footer v-if="hasStarted || !isDesktopLayout" class="chat-composer-zone" :class="{ 'is-live': hasStarted }">
        <div class="chat-composer-card">
          <textarea
            ref="footerComposerRef"
            v-model="input"
            rows="1"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
            @input="handleComposerInput"
            @keydown="handleComposerKeydown"
            placeholder="Ask anything"
            class="chat-composer-input"
          ></textarea>

          <div class="chat-composer-footer">
            <p class="chat-composer-note">ChatGPT can make mistakes. Check important info.</p>
            <button
              @click="handleSend"
              :disabled="!input.trim() || isLoading"
              :class="['chat-send-btn', input.trim() && !isLoading ? 'is-active' : '']"
              type="button"
              aria-label="Send message"
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
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { X, Plus, Search, PenSquare, Menu, ArrowUp, LoaderCircle, Trash2 } from 'lucide-vue-next'
import { sendMessageStream } from '../api/deepseek'
import { shouldUseWebSearchTool, runWebSearchTool, buildWebSearchContext } from '../api/webSearchTool'
import {
  getAdsPlacementIds,
  getAdsIntentScore,
  requestAdBid,
  reportInlineAdEvent,
  reportAdPostbackEvent,
} from '../api/adsSdk'
import {
  TOOL_STATES,
  getHostFromUrl,
  normalizeSourceItem,
  normalizeMessage as normalizeMessageRuntime,
  normalizeSession as normalizeSessionRuntime,
  normalizeTurnLog as normalizeTurnLogRuntime,
  getLatestRetryCountForPrompt,
  buildModelMessages,
  buildStableConversionId,
  shouldSimulateSuccessfulPostback,
} from '../utils/chatRuntime'
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
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Be accurate, concise, and explicit about uncertainty.'

const input = ref('')
const historyQuery = ref('')
const desktopMediaQuery = typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 1100px)')
  : null
const isSidebarOpen = ref(desktopMediaQuery ? desktopMediaQuery.matches : true)
const isDesktopLayout = ref(desktopMediaQuery ? desktopMediaQuery.matches : true)
const scrollRef = ref(null)
const homeComposerRef = ref(null)
const footerComposerRef = ref(null)
const isLoading = ref(false)
const isComposing = ref(false)
const queryRewriteMessageId = ref('')
const queryRewriteDraft = ref('')

const sessions = ref([])
const activeSessionId = ref('')
const turnLogs = ref([])

let persistTimer = null
let detachDesktopMediaListener = null

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

function normalizeMessage(raw) {
  return normalizeMessageRuntime(raw, {
    createId,
    toolStates: TOOL_STATES,
  })
}

function normalizeSession(raw) {
  return normalizeSessionRuntime(raw, {
    createId,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    toolStates: TOOL_STATES,
  })
}

function normalizeTurnLog(raw) {
  return normalizeTurnLogRuntime(raw)
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
const currentMessages = computed(() => activeSession.value?.messages || [])

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

function syncTextareaHeight(element) {
  if (!element) return
  element.style.height = 'auto'
  const nextHeight = Math.min(Math.max(element.scrollHeight, 24), 220)
  element.style.height = `${nextHeight}px`
}

function syncComposerHeights() {
  syncTextareaHeight(homeComposerRef.value)
  syncTextareaHeight(footerComposerRef.value)
}

function handleComposerInput(event) {
  syncTextareaHeight(event?.target)
}

function handleComposerKeydown(event) {
  if (event?.key !== 'Enter') return
  if (event.shiftKey || event.isComposing || isComposing.value) return
  event.preventDefault()
  void handleSend()
}

watch(
  currentMessages,
  () => {
    if (hasStarted.value) {
      scrollToBottom()
    }
    nextTick(() => {
      syncComposerHeights()
    })
  },
  { deep: true },
)

watch(input, () => {
  nextTick(() => {
    syncComposerHeights()
  })
})

onBeforeUnmount(() => {
  if (detachDesktopMediaListener) {
    detachDesktopMediaListener()
    detachDesktopMediaListener = null
  }
  if (persistTimer) {
    clearTimeout(persistTimer)
  }
})

onMounted(() => {
  nextTick(() => {
    syncComposerHeights()
  })

  if (!desktopMediaQuery) return

  const syncSidebarState = (event) => {
    isDesktopLayout.value = event.matches
    isSidebarOpen.value = event.matches
  }

  syncSidebarState(desktopMediaQuery)

  if (typeof desktopMediaQuery.addEventListener === 'function') {
    desktopMediaQuery.addEventListener('change', syncSidebarState)
    detachDesktopMediaListener = () => desktopMediaQuery.removeEventListener('change', syncSidebarState)
    return
  }

  desktopMediaQuery.addListener(syncSidebarState)
  detachDesktopMediaListener = () => desktopMediaQuery.removeListener(syncSidebarState)
})

function touchActiveSession() {
  const session = activeSession.value
  if (!session) return
  session.updatedAt = Date.now()
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

function openSession(sessionId) {
  cancelQueryRewriteEdit()
  activeSessionId.value = sessionId
  if (!isDesktopLayout.value) {
    isSidebarOpen.value = false
  }
  scrollToBottom()
}

function startNewChat() {
  cancelQueryRewriteEdit()
  const newSession = createSession()
  sessions.value = [newSession, ...sessions.value].slice(0, MAX_SESSIONS)
  activeSessionId.value = newSession.id
  historyQuery.value = ''
  if (!isDesktopLayout.value) {
    isSidebarOpen.value = false
  }
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
.chat-shell {
  --chat-sidebar-width: 260px;
  --chat-topbar-height: 52px;
  --chat-thread-max: 40rem;
  --chat-thread-max-lg: 48rem;
  --chat-edge-padding: clamp(16px, 2.4vw, 64px);

  position: relative;
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  color: #0d0d0d;
  background: #f9f9f9;
  font-family: var(--font-body);
}

.chat-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  display: flex;
  width: var(--chat-sidebar-width);
  flex-direction: column;
  border-right: 1px solid #e6e6e6;
  background: #f9f9f9;
  transform: translateX(-105%);
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-sidebar.is-open {
  transform: translateX(0);
}

.chat-sidebar-top {
  border-bottom: 1px solid #ececec;
  padding: 8px;
}

.chat-sidebar-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-icon-btn {
  height: 36px;
  width: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #5d5d5d;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-icon-btn:hover {
  background: #ececec;
}

.chat-icon-btn:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.chat-mobile-only {
  display: inline-flex;
}

.chat-new-btn {
  min-height: 36px;
  flex: 1;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #0d0d0d;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-new-btn:hover {
  background: #ececec;
}

.chat-new-btn:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.chat-search-field {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  border-radius: 10px;
  background: transparent;
  color: #5d5d5d;
  padding: 6px 10px;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-search-field:hover,
.chat-search-field:focus-within {
  background: #ececec;
}

.chat-search-field input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #0d0d0d;
  font-size: 14px;
  line-height: 20px;
}

.chat-search-field input::placeholder {
  color: #8f8f8f;
}

.chat-session-section {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px;
}

.chat-section-label {
  margin: 0;
  padding: 4px 10px;
  color: #8f8f8f;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
}

.chat-session-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 2px;
  padding-bottom: 8px;
}

.chat-session-item {
  position: relative;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-session-item:hover {
  border-color: #e4e4e4;
  background: #efefef;
}

.chat-session-item.is-active {
  border-color: #dddddd;
  background: #e9e9e9;
}

.chat-session-main {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  display: grid;
  gap: 1px;
  text-align: left;
  padding: 8px 30px 8px 10px;
  cursor: pointer;
}

.chat-session-main:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
  border-radius: 10px;
}

.chat-session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.chat-session-time {
  color: #8f8f8f;
  font-size: 11px;
  line-height: 16px;
}

.chat-session-delete {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  height: 24px;
  width: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #757575;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-session-item:hover .chat-session-delete,
.chat-session-item:focus-within .chat-session-delete {
  opacity: 1;
}

.chat-session-delete:hover {
  background: #dfdfdf;
}

.chat-session-delete:focus-visible {
  opacity: 1;
  outline: 1.5px solid #0d0d0d;
  outline-offset: 1px;
}

.chat-session-delete:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-session-empty {
  margin: 6px 10px;
  color: #8f8f8f;
  font-size: 12px;
  line-height: 16px;
}

.chat-sidebar-footer {
  border-top: 1px solid #e6e6e6;
  padding: 8px;
}

.chat-clear-btn {
  width: 100%;
  min-height: 36px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #5d5d5d;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  padding: 6px 10px;
  cursor: pointer;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-clear-btn:hover:not(:disabled) {
  background: #ececec;
  color: #0d0d0d;
}

.chat-clear-btn:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.chat-clear-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  border: 0;
  background: rgba(0, 0, 0, 0.42);
}

.chat-main {
  position: relative;
  z-index: 10;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  min-height: var(--chat-topbar-height);
  border-bottom: 1px solid #ececec;
  background: #f9f9f9;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
}

.chat-topbar-left {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.chat-title {
  margin: 0;
  font-size: 18px;
  line-height: 28px;
  font-weight: 400;
  color: #0d0d0d;
}

.chat-new-inline-btn {
  height: 36px;
  width: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #5d5d5d;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-new-inline-btn:hover {
  background: #ececec;
}

.chat-new-inline-btn:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.chat-scroll-region {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--chat-edge-padding) 24px;
}

.chat-hero {
  margin: clamp(84px, 19vh, 172px) auto 16px;
  width: min(var(--chat-thread-max-lg), 100%);
  text-align: center;
  max-height: 280px;
  overflow: hidden;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), margin 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-hero.is-hidden {
  opacity: 0;
  transform: translateY(-8px);
  max-height: 0;
  margin: 0 auto;
}

.chat-hero h2 {
  margin: 0;
  font-size: 42px;
  line-height: 52px;
  font-weight: 400;
  letter-spacing: 0.1px;
}

.chat-hero p {
  margin: 10px 0 0;
  color: #8f8f8f;
  font-size: 20px;
  line-height: 28px;
}

.chat-home-composer {
  margin: 28px auto 0;
  width: min(var(--chat-thread-max-lg), 100%);
}

.chat-thread {
  margin: 0 auto;
  width: min(var(--chat-thread-max), 100%);
  opacity: 0;
  transform: translateY(12px);
  pointer-events: none;
  transition: opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1), transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-thread.is-visible {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.chat-turn {
  margin-bottom: 24px;
}

.chat-turn-inner {
  display: flex;
}

.chat-turn.is-user .chat-turn-inner {
  justify-content: flex-end;
}

.chat-message {
  width: 100%;
  font-size: 16px;
  line-height: 24px;
  color: #0d0d0d;
}

.chat-message-user {
  width: auto;
  max-width: 70%;
  border-radius: 18px;
  background: #f3f3f3;
  border: 1px solid #e0e0e0;
  padding: 10px 16px;
}

.chat-message-assistant {
  width: 100%;
  padding: 0;
}

.chat-rewrite-input {
  width: 100%;
  border: 1px solid #d0d0d0;
  border-radius: 12px;
  background: #fff;
  color: #0d0d0d;
  font-size: 14px;
  line-height: 20px;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
}

.chat-rewrite-input:focus {
  border-color: #0d0d0d;
}

.chat-message-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chat-message-actions-right {
  justify-content: flex-end;
}

.chat-btn-ghost,
.chat-btn-solid {
  min-height: 32px;
  border-radius: 999px;
  border: 1px solid #d7d7d7;
  background: #f9f9f9;
  color: #4a4a4a;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  cursor: pointer;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-btn-ghost:hover:not(:disabled) {
  border-color: #cfcfcf;
  background: #efefef;
  color: #0d0d0d;
}

.chat-btn-solid {
  border-color: #0d0d0d;
  background: #0d0d0d;
  color: #fff;
}

.chat-btn-solid:hover:not(:disabled) {
  background: #1f1f1f;
  border-color: #1f1f1f;
}

.chat-btn-ghost:focus-visible,
.chat-btn-solid:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.chat-btn-ghost:disabled,
.chat-btn-solid:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-tool-card {
  border: 1px solid #dfdfdf;
  border-radius: 12px;
  background: #f3f3f3;
  padding: 12px;
}

.chat-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5d5d5d;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.chat-tool-name {
  border-radius: 999px;
  background: #ececec;
  padding: 3px 8px;
}

.chat-tool-state {
  margin-left: auto;
  font-size: 11px;
  letter-spacing: normal;
  text-transform: none;
  font-weight: 600;
}

.chat-tool-query,
.chat-tool-latency,
.chat-tool-error,
.chat-tool-running {
  margin-top: 10px;
  font-size: 12px;
  line-height: 16px;
}

.chat-tool-running {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.chat-tool-error {
  color: #a4332a;
}

.chat-tool-results {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.chat-tool-results li {
  border: 1px solid #dddddd;
  border-radius: 10px;
  background: #fff;
  padding: 9px 10px;
}

.chat-tool-results a {
  text-decoration: none;
  color: #0d0d0d;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
}

.chat-tool-results a:hover {
  text-decoration: underline;
}

.chat-tool-results a:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
  border-radius: 6px;
}

.chat-tool-results p {
  margin: 4px 0 0;
  color: #5d5d5d;
  font-size: 12px;
  line-height: 16px;
}

.chat-reasoning {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #5d5d5d;
  font-size: 14px;
  line-height: 20px;
}

.chat-stream-caret {
  margin-left: 2px;
  width: 2px;
  height: 18px;
  display: inline-block;
  background: #0d0d0d;
  vertical-align: middle;
}

.chat-retry-tag {
  color: #8f8f8f;
  font-size: 11px;
  line-height: 16px;
}

.chat-thread-tail {
  height: 14px;
}

.chat-composer-zone {
  position: sticky;
  bottom: 0;
  z-index: 21;
  padding: 8px var(--chat-edge-padding) 28px;
  background: linear-gradient(to top, #f9f9f9 72%, transparent);
}

.chat-composer-card {
  width: min(var(--chat-thread-max-lg), 100%);
  margin: 0 auto;
  min-height: 56px;
  border: 1px solid #d9d9d9;
  border-radius: 28px;
  background: #fff;
  padding: 10px 56px 10px 16px;
  position: relative;
}

.chat-composer-home {
  width: 100%;
}

.chat-composer-input {
  width: 100%;
  border: 0;
  outline: 0;
  resize: none;
  min-height: 24px;
  max-height: 220px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: #0d0d0d;
  font-size: 16px;
  line-height: 24px;
}

.chat-composer-input::placeholder {
  color: #8f8f8f;
}

.chat-composer-footer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.chat-composer-note {
  position: absolute;
  left: 50%;
  bottom: -24px;
  transform: translateX(-50%);
  margin: 0;
  white-space: nowrap;
  color: #8f8f8f;
  font-size: 12px;
  line-height: 16px;
}

.chat-send-btn {
  position: absolute;
  right: 10px;
  top: 10px;
  height: 36px;
  width: 36px;
  border-radius: 999px;
  border: 1px solid #cccccc;
  background: #ececec;
  color: #9b9b9b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-send-btn.is-active {
  border-color: #0d0d0d;
  background: #0d0d0d;
  color: #fff;
  cursor: pointer;
}

.chat-send-btn.is-active:hover {
  background: #1f1f1f;
  border-color: #1f1f1f;
}

.chat-send-btn:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.chat-send-btn:disabled {
  cursor: default;
}

@media (min-width: 1100px) {
  .chat-sidebar {
    position: relative;
    inset: auto;
    transform: none;
    z-index: 20;
  }

  .chat-mobile-only {
    display: none;
  }

  .chat-sidebar-overlay {
    display: none;
  }

  .chat-thread {
    width: min(var(--chat-thread-max-lg), 100%);
  }
}

@media (max-width: 1099px) {
  .chat-sidebar {
    width: min(80vw, 300px);
  }

  .chat-topbar {
    padding: 8px 10px;
  }

  .chat-scroll-region {
    padding-inline: 16px;
  }

  .chat-composer-zone {
    padding-inline: 16px;
    padding-bottom: 16px;
  }

  .chat-composer-note {
    display: none;
  }
}

@media (max-width: 720px) {
  .chat-hero {
    margin-top: clamp(74px, 16vh, 130px);
  }

  .chat-hero h2 {
    font-size: 32px;
    line-height: 40px;
  }

  .chat-hero p {
    font-size: 16px;
    line-height: 24px;
    margin-top: 6px;
  }

  .chat-message-user {
    max-width: 92%;
  }

  .chat-new-inline-btn,
  .chat-icon-btn {
    height: 40px;
    width: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-shell *,
  .chat-shell *::before,
  .chat-shell *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
