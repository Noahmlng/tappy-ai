<template>
  <div class="chat-app">
    <ChatSidebar
      :is-sidebar-open="isSidebarOpen"
      :history-query="historyQuery"
      :filtered-sessions="filteredSessions"
      :active-session-id="activeSessionId"
      :active-session="activeSession"
      :active-system-prompt="activeSystemPrompt"
      :active-session-turn-logs="activeSessionTurnLogs"
      :trace-panel-open="isTracePanelOpen"
      :format-session-time="formatSessionTime"
      :format-trace-time="formatTraceTime"
      :format-trace-event-type="formatTraceEventType"
      @close-sidebar="isSidebarOpen = false"
      @start-new-chat="startNewChat"
      @open-session="openSession"
      @delete-session="deleteSession"
      @update:history-query="historyQuery = $event"
      @reset-system-prompt="resetActiveSystemPrompt"
      @update:active-system-prompt="activeSystemPrompt = $event"
      @clear-history="clearHistory"
      @update:trace-panel-open="isTracePanelOpen = $event"
    />

    <main class="chat-main chat-main-shell relative flex h-full flex-1 flex-col overflow-hidden">
      <ChatTopbar
        :is-sidebar-open="isSidebarOpen"
        title="Simulator"
        @open-sidebar="isSidebarOpen = true"
        @start-new-chat="startNewChat"
      />

      <div ref="scrollRef" class="chat-main-scroll flex flex-1 flex-col overflow-y-auto">
        <MessageList
          :has-started="hasStarted"
          :current-messages="currentMessages"
          :is-loading="isLoading"
          :query-rewrite-message-id="queryRewriteMessageId"
          :query-rewrite-draft="queryRewriteDraft"
          :format-tool-state="formatToolState"
          :get-host-label="getHostLabel"
          :resolve-message-content-for-rendering="resolveMessageContentForRendering"
          :resolve-inline-offers-for-message="resolveInlineOffersForMessage"
          :resolve-ad-href="resolveAdHref"
          @start-query-rewrite-edit="startQueryRewriteEdit"
          @cancel-query-rewrite-edit="cancelQueryRewriteEdit"
          @update:query-rewrite-draft="queryRewriteDraft = $event"
          @submit-query-rewrite="submitQueryRewrite"
          @inline-offer-click="({ msg, ad }) => handleInlineOfferClick(msg, ad)"
          @inline-marker-count="({ msg, count }) => handleInlineMarkerCount(msg, count)"
          @regenerate="handleRegenerate"
          @source-click="({ msg, source }) => handleSourceClick(msg, source)"
          @sponsored-ad-click="({ msg, ad }) => handleSponsoredAdClick(msg, ad)"
          @follow-up-select="handleFollowUpSelect"
          @next-step-ad-click="({ msg, ad }) => handleNextStepAdClick(msg, ad)"
          @next-step-ad-dismiss="handleNextStepAdDismiss"
        />

        <ComposerBar
          :model-value="input"
          :is-loading="isLoading"
          :has-started="hasStarted"
          @update:model-value="input = $event"
          @send="handleSend"
          @composition-start="isComposing = true"
          @composition-end="isComposing = false"
        />

        <div
          class="cubic-bezier-transition shrink-0 transition-all duration-[700ms]"
          :class="hasStarted ? 'max-h-0' : 'max-h-[25vh] flex-grow'"
        ></div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { sendMessageStream } from '../api/deepseek'
import { shouldUseWebSearchTool, runWebSearchTool, buildWebSearchContext } from '../api/webSearchTool'
import {
  reportAdsEvent,
  runAttachPlacementFlow,
  runNextStepIntentCardPlacementFlow,
} from '../api/adsPlatformClient'
import ChatSidebar from '../components/chat/ChatSidebar.vue'
import ChatTopbar from '../components/chat/ChatTopbar.vue'
import ComposerBar from '../components/chat/ComposerBar.vue'
import MessageList from '../components/chat/MessageList.vue'

const STORAGE_KEY = 'chat_bot_history_v3'
const LEGACY_STORAGE_KEYS = ['chat_bot_history_v2', 'chat_bot_sessions_v1']
const TURN_LOG_STORAGE_KEY = 'chat_bot_turn_logs_v2'
const LEGACY_TURN_LOG_STORAGE_KEYS = ['chat_bot_turn_logs_v1']
const UI_PREFS_STORAGE_KEY = 'chat_bot_ui_prefs_v1'
const MAX_SESSIONS = 50
const MAX_TURN_LOGS = 400
const TOOL_STATES = ['planning', 'running', 'done', 'error']
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Be accurate, concise, and explicit about uncertainty.'
const ADS_PLATFORM_APP_ID = import.meta.env.VITE_SIMULATOR_APP_ID || import.meta.env.APP_ID || 'simulator-chatbot'
const ATTACH_LINK_PLACEMENT_KEY = 'attach.post_answer_render'
const ENABLE_NEXT_STEP_FLOW = String(
  import.meta.env.VITE_ENABLE_NEXT_STEP_FLOW ??
  import.meta.env.ENABLE_NEXT_STEP_FLOW ??
  'true',
).trim().toLowerCase() !== 'false'

const input = ref('')
const historyQuery = ref('')
const isSidebarOpen = ref(true)
const scrollRef = ref(null)
const isLoading = ref(false)
const isComposing = ref(false)
const queryRewriteMessageId = ref('')
const queryRewriteDraft = ref('')
const isTracePanelOpen = ref(true)

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

function pickFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text) return text
  }
  return ''
}

function resolveAdHref(ad) {
  if (!ad || typeof ad !== 'object') return ''
  return pickFirstNonEmptyString(
    ad.clickUrl,
    ad.click_url,
    ad.targetUrl,
    ad.target_url,
  )
}

function normalizeAdItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const adId = typeof raw.adId === 'string' ? raw.adId : `ad_${index}`
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const tracking = raw.tracking && typeof raw.tracking === 'object' ? raw.tracking : {}
  const clickUrl = pickFirstNonEmptyString(
    tracking.clickUrl,
    tracking.click_url,
    raw.clickUrl,
    raw.click_url,
  )
  const targetUrl = pickFirstNonEmptyString(raw.targetUrl, raw.target_url)
  if (!title || !resolveAdHref({ clickUrl, targetUrl })) return null

  return {
    adId,
    title,
    description: typeof raw.description === 'string' ? raw.description : '',
    clickUrl,
    targetUrl,
    disclosure: raw.disclosure === 'Ad' ? 'Ad' : 'Sponsored',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    entityText: typeof raw.entityText === 'string' ? raw.entityText.trim() : '',
    entityType: typeof raw.entityType === 'string' ? raw.entityType.trim() : '',
    sourceNetwork: typeof raw.sourceNetwork === 'string' ? raw.sourceNetwork.trim() : '',
  }
}

function normalizeAttachAdSlot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const allowedDecisionValues = new Set(['served', 'no_fill', 'blocked', 'error'])
  const ads = Array.isArray(raw.ads)
    ? raw.ads.map((item, index) => normalizeAdItem(item, index)).filter(Boolean)
    : []
  const decision = raw.decision && typeof raw.decision === 'object'
    ? {
        result: allowedDecisionValues.has(raw.decision.result) ? raw.decision.result : 'error',
        reason: allowedDecisionValues.has(raw.decision.reason) ? raw.decision.reason : 'error',
        reasonDetail: typeof raw.decision.reasonDetail === 'string' ? raw.decision.reasonDetail : '',
        intentScore: Number.isFinite(raw.decision.intentScore) ? raw.decision.intentScore : 0,
      }
    : {
        result: 'error',
        reason: 'error',
        reasonDetail: '',
        intentScore: 0,
      }

  return {
    requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
    placementId: typeof raw.placementId === 'string' ? raw.placementId : '',
    placementKey: typeof raw.placementKey === 'string' ? raw.placementKey : ATTACH_LINK_PLACEMENT_KEY,
    decision,
    ads,
    reportPayload: raw.reportPayload && typeof raw.reportPayload === 'object'
      ? {
          requestId: String(raw.reportPayload.requestId || ''),
          appId: String(raw.reportPayload.appId || ''),
          sessionId: String(raw.reportPayload.sessionId || ''),
          turnId: String(raw.reportPayload.turnId || ''),
          query: String(raw.reportPayload.query || ''),
          answerText: String(raw.reportPayload.answerText || ''),
          intentScore: Number(raw.reportPayload.intentScore) || 0,
          locale: String(raw.reportPayload.locale || ''),
        }
      : null,
  }
}

function normalizeNextStepAdItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const itemId = typeof raw.item_id === 'string'
    ? raw.item_id
    : typeof raw.itemId === 'string'
      ? raw.itemId
      : typeof raw.adId === 'string'
        ? raw.adId
        : `next_step_${index}`
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const tracking = raw.tracking && typeof raw.tracking === 'object' ? raw.tracking : {}
  const clickUrl = pickFirstNonEmptyString(
    tracking.click_url,
    tracking.clickUrl,
    raw.click_url,
    raw.clickUrl,
  )
  const targetUrl = pickFirstNonEmptyString(raw.target_url, raw.targetUrl)

  if (!title || !resolveAdHref({ clickUrl, targetUrl })) return null

  const matchReasons = Array.isArray(raw.match_reasons)
    ? raw.match_reasons.map((item) => String(item || '').trim()).filter(Boolean)
    : Array.isArray(raw.matchReasons)
      ? raw.matchReasons.map((item) => String(item || '').trim()).filter(Boolean)
      : []

  return {
    itemId,
    adId: itemId,
    title,
    snippet: typeof raw.snippet === 'string'
      ? raw.snippet
      : typeof raw.description === 'string'
        ? raw.description
        : '',
    clickUrl,
    targetUrl,
    merchantOrNetwork: typeof raw.merchant_or_network === 'string'
      ? raw.merchant_or_network
      : typeof raw.merchantOrNetwork === 'string'
        ? raw.merchantOrNetwork
        : typeof raw.sourceNetwork === 'string'
          ? raw.sourceNetwork
          : '',
    priceHint: typeof raw.price_hint === 'string'
      ? raw.price_hint
      : typeof raw.priceHint === 'string'
        ? raw.priceHint
        : '',
    matchReasons,
    relevanceScore: Number.isFinite(raw.relevance_score)
      ? raw.relevance_score
      : Number.isFinite(raw.relevanceScore)
        ? raw.relevanceScore
        : null,
    disclosure: raw.disclosure === 'Ad' ? 'Ad' : 'Sponsored',
  }
}

function resolveNextStepAdId(slot, ad = null) {
  const fromAd = pickFirstNonEmptyString(ad?.itemId, ad?.adId)
  if (fromAd) return fromAd
  const firstAd = Array.isArray(slot?.ads) ? slot.ads[0] : null
  return pickFirstNonEmptyString(firstAd?.itemId, firstAd?.adId)
}

function normalizeNextStepAdSlot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const allowedDecisionValues = new Set(['served', 'no_fill', 'blocked', 'error'])
  const ads = Array.isArray(raw.ads)
    ? raw.ads.map((item, index) => normalizeNextStepAdItem(item, index)).filter(Boolean)
    : []
  const decision = raw.decision && typeof raw.decision === 'object'
    ? {
        result: allowedDecisionValues.has(raw.decision.result) ? raw.decision.result : 'error',
        reason: allowedDecisionValues.has(raw.decision.reason) ? raw.decision.reason : 'error',
        reasonDetail: typeof raw.decision.reasonDetail === 'string' ? raw.decision.reasonDetail : '',
        intentScore: Number.isFinite(raw.decision.intent_score)
          ? raw.decision.intent_score
          : Number.isFinite(raw.decision.intentScore)
            ? raw.decision.intentScore
            : 0,
      }
    : {
        result: 'error',
        reason: 'error',
        reasonDetail: '',
        intentScore: 0,
      }
  const intentInferenceRaw = raw.intent_inference && typeof raw.intent_inference === 'object'
    ? raw.intent_inference
    : {}

  return {
    requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
    placementId: typeof raw.placementId === 'string' ? raw.placementId : '',
    placementKey: typeof raw.placementKey === 'string' ? raw.placementKey : 'next_step.intent_card',
    decision,
    intentInference: {
      intentClass: typeof intentInferenceRaw.intent_class === 'string' ? intentInferenceRaw.intent_class : '',
      intentScore: Number.isFinite(intentInferenceRaw.intent_score) ? intentInferenceRaw.intent_score : 0,
      preferenceFacets: Array.isArray(intentInferenceRaw.preference_facets)
        ? intentInferenceRaw.preference_facets
        : [],
    },
    ads,
    dismissedAt: Number.isFinite(raw.dismissedAt)
      ? raw.dismissedAt
      : Number.isFinite(raw.dismissed_at)
        ? raw.dismissed_at
        : null,
    reportPayload: raw.reportPayload && typeof raw.reportPayload === 'object' ? raw.reportPayload : null,
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

function normalizeMessage(raw) {
  if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) return null

  const toolState = TOOL_STATES.includes(raw.toolState) ? raw.toolState : 'done'
  const toolResults = Array.isArray(raw.toolResults)
    ? raw.toolResults.map((item, index) => normalizeToolResultItem(item, index)).filter(Boolean)
    : []

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
    attachAdSlot: normalizeAttachAdSlot(raw.attachAdSlot),
    inlineMarkerCount: Number.isFinite(raw.inlineMarkerCount) ? Math.max(0, Math.floor(raw.inlineMarkerCount)) : 0,
    nextStepAdSlot: normalizeNextStepAdSlot(raw.nextStepAdSlot),
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

function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY)
    if (!raw) {
      isTracePanelOpen.value = true
      return
    }
    const parsed = JSON.parse(raw)
    isTracePanelOpen.value = parsed?.tracePanelOpen !== false
  } catch (error) {
    console.error('Failed to load UI prefs:', error)
    isTracePanelOpen.value = true
  }
}

function persistUiPrefs() {
  localStorage.setItem(
    UI_PREFS_STORAGE_KEY,
    JSON.stringify({
      tracePanelOpen: Boolean(isTracePanelOpen.value),
    }),
  )
}

loadSessions()
loadTurnLogs()
loadUiPrefs()

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

watch(isTracePanelOpen, () => {
  persistUiPrefs()
})

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

function estimateIntentScore(query) {
  const text = String(query || '').toLowerCase()
  if (!text) return 0

  const signals = [
    'buy',
    'price',
    'deal',
    'discount',
    'best',
    'compare',
    'top',
    'recommend',
    'platform',
    'platforms',
    'tool',
    'tools',
    'app',
    'apps',
    'broker',
    'brokers',
    'forecast',
    'forecasts',
    'portfolio',
    'market news',
    'alerts',
    'subscription',
    'plan',
    '\u4e70',
    '\u4ef7\u683c',
    '\u6298\u6263',
    '\u63a8\u8350',
    '\u9001\u793c',
  ]
  const hits = signals.reduce((count, signal) => (text.includes(signal) ? count + 1 : count), 0)
  const score = 0.3 + hits * 0.12
  return Math.min(0.95, Math.max(0.05, Number(score.toFixed(2))))
}

function inferIntentClass(query) {
  const text = String(query || '').toLowerCase()
  if (!text) return 'non_commercial'

  const giftingSignals = [
    'gift',
    'present',
    'for her',
    'for him',
    '\u9001\u793c',
    '\u793c\u7269',
    '\u5973\u670b\u53cb',
    '\u7537\u670b\u53cb',
  ]
  const purchaseSignals = [
    'buy',
    'purchase',
    'checkout',
    'deal',
    'discount',
    '\u4e70',
    '\u4e0b\u5355',
    '\u4f18\u60e0',
  ]
  const explorationSignals = [
    'recommend',
    'compare',
    'top',
    'best',
    'platform',
    'platforms',
    'tool',
    'tools',
    'app',
    'apps',
    'broker',
    'brokers',
    'forecast',
    'forecasts',
    'portfolio',
    'market news',
    'alerts',
    '\u63a8\u8350',
    '\u6bd4\u8f83',
  ]

  if (giftingSignals.some((signal) => text.includes(signal))) return 'gifting'
  if (purchaseSignals.some((signal) => text.includes(signal))) return 'purchase_intent'
  if (explorationSignals.some((signal) => text.includes(signal))) return 'product_exploration'
  return 'non_commercial'
}

function extractPreferenceFacets(query) {
  const text = String(query || '').trim().toLowerCase()
  if (!text) return []

  const facets = []
  const rules = [
    { facetKey: 'recipient', words: ['girlfriend', 'boyfriend', '\u5973\u670b\u53cb', '\u7537\u670b\u53cb'] },
    { facetKey: 'style', words: ['minimal', 'vintage', 'luxury', '\u7b80\u7ea6', '\u590d\u53e4', '\u8f7b\u5962'] },
    { facetKey: 'material', words: ['cotton', 'silk', 'wool', '\u6750\u8d28', '\u4e1d', '\u68c9', '\u7f8a\u6bdb'] },
    { facetKey: 'color', words: ['colorful', 'bright', 'red', 'blue', '\u9c9c\u8273', '\u7ea2', '\u84dd'] },
  ]

  for (const rule of rules) {
    const match = rule.words.find((word) => text.includes(word))
    if (!match) continue
    facets.push({
      facet_key: rule.facetKey,
      facet_value: match,
      confidence: 0.74,
      source: 'llm_inference',
    })
  }

  const budgetMatch = text.match(/(?:\$|usd|rmb|cny)?\s?(\d{2,5})/)
  if (budgetMatch) {
    facets.push({
      facet_key: 'price',
      facet_value: budgetMatch[1],
      confidence: 0.7,
      source: 'user_query',
    })
  }

  return facets.slice(0, 8)
}

function buildRecentTurns(session, limit = 6) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const turns = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.kind === 'tool') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (typeof message.content !== 'string' || !message.content.trim()) continue

    turns.push({
      role: message.role,
      content: message.content.trim(),
    })
    if (turns.length >= limit) break
  }

  return turns.reverse()
}

function getClientLocale() {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.trim()) {
    return navigator.language.trim()
  }
  return 'en-US'
}

function findMessageById(sessionId, messageId) {
  const targetSession = sessions.value.find((item) => item.id === sessionId)
  if (!targetSession || !Array.isArray(targetSession.messages)) return null
  return targetSession.messages.find((message) => message?.id === messageId) || null
}

function resolveInlineOffersForMessage(message) {
  // P1: remove forced sponsored insertion in body to avoid duplicate rendering
  // with the dedicated sponsored ad card.
  return []
}

function resolveMessageContentForRendering(message) {
  return typeof message?.content === 'string' ? message.content : ''
}

async function runAttachAdsFlow({ session, userContent, assistantMessageId, turnTrace }) {
  const currentMessage = findMessageById(session.id, assistantMessageId)
  if (!currentMessage) return

  const reportPayload = {
    appId: ADS_PLATFORM_APP_ID,
    sessionId: session.id,
    turnId: turnTrace.turnId,
    query: userContent,
    answerText: currentMessage.content,
    intentScore: estimateIntentScore(userContent),
    locale: getClientLocale(),
  }

  appendTurnTraceEvent(turnTrace, 'ads_config_fetch_started', {
    appId: reportPayload.appId,
  })
  appendTurnTraceEvent(turnTrace, 'ads_evaluate_started', {
    placementKey: 'attach.post_answer_render',
    event: 'answer_completed',
  })
  upsertTurnTrace(turnTrace)

  let flow
  try {
    flow = await runAttachPlacementFlow(reportPayload)
  } catch (error) {
    appendTurnTraceEvent(turnTrace, 'ads_evaluate_failed', {
      error: error instanceof Error ? error.message : 'evaluate_failed',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  const configEvidence = flow?.evidence?.config || null
  if (configEvidence?.ok) {
    appendTurnTraceEvent(turnTrace, 'ads_config_fetch_completed', {
      status: configEvidence.status || 200,
      placementId: configEvidence.placementId || 'chat_inline_v1',
      placementKey: configEvidence.placementKey || ATTACH_LINK_PLACEMENT_KEY,
    })
  } else {
    appendTurnTraceEvent(turnTrace, 'ads_config_fetch_failed', {
      error: configEvidence?.error || flow?.error || 'config_fetch_failed',
    })
  }
  upsertTurnTrace(turnTrace)

  if (flow?.skipped) {
    appendTurnTraceEvent(turnTrace, 'ads_skipped', {
      placementKey: flow?.placementKey || ATTACH_LINK_PLACEMENT_KEY,
      reason: flow?.skipReason || 'placement_disabled',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  const attachEvaluateError = String(flow?.evidence?.evaluate?.error || '').trim()
  if (!flow?.evidence?.evaluate?.ok && attachEvaluateError) {
    appendTurnTraceEvent(turnTrace, 'ads_evaluate_failed', {
      placementKey: flow?.placementKey || ATTACH_LINK_PLACEMENT_KEY,
      error: attachEvaluateError,
    })
    upsertTurnTrace(turnTrace)
  }

  const targetMessage = findMessageById(session.id, assistantMessageId)
  if (!targetMessage) return

  reportPayload.requestId = String(flow?.requestId || '')
  targetMessage.attachAdSlot = normalizeAttachAdSlot({
    requestId: flow?.requestId,
    placementId: flow?.placementId,
    placementKey: ATTACH_LINK_PLACEMENT_KEY,
    decision: flow?.decision,
    ads: flow?.ads,
    reportPayload,
  })
  targetMessage.inlineMarkerCount = 0
  touchActiveSession()
  scheduleSaveSessions()

  appendTurnTraceEvent(turnTrace, 'ads_evaluate_completed', {
    requestId: flow?.requestId || '',
    result: flow?.decision?.result || 'unknown',
    reason: flow?.decision?.reason || '',
    reasonDetail: flow?.decision?.reasonDetail || '',
    adCount: Array.isArray(flow?.ads) ? flow.ads.length : 0,
  })
  if (flow?.evidence?.events?.skipped) {
    appendTurnTraceEvent(turnTrace, 'ads_event_skipped', {
      requestId: flow?.requestId || '',
      kind: 'impression',
      reason: 'decision_not_served',
    })
  } else if (flow?.evidence?.events?.ok) {
    appendTurnTraceEvent(turnTrace, 'ads_event_reported', {
      requestId: flow?.requestId || '',
      kind: 'impression',
    })
  } else {
    appendTurnTraceEvent(turnTrace, 'ads_event_report_failed', {
      requestId: flow?.requestId || '',
      kind: 'impression',
      error: flow?.evidence?.events?.error || 'event_report_failed',
    })
  }
  if (flow?.failOpenApplied) {
    appendTurnTraceEvent(turnTrace, 'ads_fail_open_applied', {
      requestId: flow?.requestId || '',
      reason: flow?.error || flow?.evidence?.events?.error || 'ads_platform_fail_open',
    })
  }
  upsertTurnTrace(turnTrace)

  const decisionResult = String(flow?.decision?.result || '').toLowerCase()
  if (decisionResult === 'served' && Array.isArray(flow?.ads) && flow.ads.length > 0) {
    appendTurnTraceEvent(turnTrace, 'ads_served', {
      requestId: flow?.requestId || '',
      placementId: flow?.placementId || '',
      adCount: flow.ads.length,
    })
    upsertTurnTrace(turnTrace)
    return
  }

  if (decisionResult === 'no_fill') {
    appendTurnTraceEvent(turnTrace, 'ads_no_fill', {
      requestId: flow?.requestId || '',
      reason: flow?.decision?.reason || '',
      reasonDetail: flow?.decision?.reasonDetail || '',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  if (decisionResult === 'blocked') {
    appendTurnTraceEvent(turnTrace, 'ads_blocked', {
      requestId: flow?.requestId || '',
      reason: flow?.decision?.reason || '',
      reasonDetail: flow?.decision?.reasonDetail || '',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  if (decisionResult === 'error') {
    appendTurnTraceEvent(turnTrace, 'ads_error', {
      requestId: flow?.requestId || '',
      reason: flow?.decision?.reason || '',
      reasonDetail: flow?.decision?.reasonDetail || '',
    })
    upsertTurnTrace(turnTrace)
  }
}

async function runNextStepIntentCardFlow({ session, userContent, assistantMessageId, turnTrace }) {
  if (!ENABLE_NEXT_STEP_FLOW) {
    appendTurnTraceEvent(turnTrace, 'next_step_skipped', {
      flow: 'next_step',
      placementKey: 'next_step.intent_card',
      reason: 'flow_disabled',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  const currentMessage = findMessageById(session.id, assistantMessageId)
  if (!currentMessage) return

  const intentClass = inferIntentClass(userContent)
  const intentScore = estimateIntentScore(userContent)
  const preferenceFacets = extractPreferenceFacets(userContent)
  const reportPayload = {
    appId: ADS_PLATFORM_APP_ID,
    sessionId: session.id,
    turnId: turnTrace.turnId,
    event: 'followup_generation',
    placementId: 'chat_followup_v1',
    placementKey: 'next_step.intent_card',
    context: {
      query: userContent,
      answerText: currentMessage.content,
      recent_turns: buildRecentTurns(session),
      locale: getClientLocale(),
      intent_class: intentClass,
      intent_score: intentScore,
      preference_facets: preferenceFacets,
    },
  }

  appendTurnTraceEvent(turnTrace, 'ads_evaluate_started', {
    placementKey: reportPayload.placementKey,
    event: reportPayload.event,
  })
  upsertTurnTrace(turnTrace)

  let flow
  try {
    flow = await runNextStepIntentCardPlacementFlow(reportPayload)
  } catch (error) {
    appendTurnTraceEvent(turnTrace, 'ads_evaluate_failed', {
      placementKey: reportPayload.placementKey,
      error: error instanceof Error ? error.message : 'evaluate_failed',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  const configEvidence = flow?.evidence?.config || null
  if (configEvidence?.ok) {
    appendTurnTraceEvent(turnTrace, 'ads_config_fetch_completed', {
      placementKey: reportPayload.placementKey,
      status: configEvidence.status || 200,
      placementId: configEvidence.placementId || reportPayload.placementId,
    })
  } else {
    appendTurnTraceEvent(turnTrace, 'ads_config_fetch_failed', {
      placementKey: reportPayload.placementKey,
      error: configEvidence?.error || flow?.error || 'config_fetch_failed',
    })
  }
  upsertTurnTrace(turnTrace)

  if (flow?.skipped) {
    appendTurnTraceEvent(turnTrace, 'next_step_skipped', {
      flow: 'next_step',
      placementKey: reportPayload.placementKey,
      reason: flow?.skipReason || 'placement_disabled',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  const nextStepEvaluateError = String(flow?.evidence?.evaluate?.error || '').trim()
  if (!flow?.evidence?.evaluate?.ok && nextStepEvaluateError) {
    appendTurnTraceEvent(turnTrace, 'ads_evaluate_failed', {
      placementKey: reportPayload.placementKey,
      error: nextStepEvaluateError,
    })
    upsertTurnTrace(turnTrace)
  }

  const targetMessage = findMessageById(session.id, assistantMessageId)
  if (!targetMessage) return

  reportPayload.requestId = String(flow?.requestId || '')
  targetMessage.nextStepAdSlot = normalizeNextStepAdSlot({
    requestId: flow?.requestId,
    placementId: flow?.placementId,
    placementKey: reportPayload.placementKey,
    decision: flow?.decision,
    ads: flow?.ads,
    reportPayload,
  })
  touchActiveSession()
  scheduleSaveSessions()

  appendTurnTraceEvent(turnTrace, 'ads_evaluate_completed', {
    placementKey: reportPayload.placementKey,
    requestId: flow?.requestId || '',
    result: flow?.decision?.result || 'unknown',
    reason: flow?.decision?.reason || '',
    reasonDetail: flow?.decision?.reasonDetail || '',
    adCount: Array.isArray(flow?.ads) ? flow.ads.length : 0,
  })
  const firstNextStepAdId = pickFirstNonEmptyString(
    flow?.ads?.[0]?.itemId,
    flow?.ads?.[0]?.item_id,
    flow?.ads?.[0]?.adId,
  )
  if (flow?.evidence?.events?.skipped) {
    appendTurnTraceEvent(turnTrace, 'ads_event_skipped', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      kind: 'impression',
      reason: 'decision_not_served',
    })
  } else if (flow?.evidence?.events?.ok) {
    appendTurnTraceEvent(turnTrace, 'ads_event_reported', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      kind: 'impression',
      adId: firstNextStepAdId,
    })
  } else {
    appendTurnTraceEvent(turnTrace, 'ads_event_report_failed', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      kind: 'impression',
      adId: firstNextStepAdId,
      error: flow?.evidence?.events?.error || 'event_report_failed',
    })
  }
  if (flow?.failOpenApplied) {
    appendTurnTraceEvent(turnTrace, 'ads_fail_open_applied', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      reason: flow?.error || flow?.evidence?.events?.error || 'ads_platform_fail_open',
    })
  }
  upsertTurnTrace(turnTrace)

  const decisionResult = String(flow?.decision?.result || '').toLowerCase()
  if (decisionResult === 'served' && Array.isArray(flow?.ads) && flow.ads.length > 0) {
    appendTurnTraceEvent(turnTrace, 'ads_served', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      placementId: flow?.placementId || '',
      adCount: flow.ads.length,
    })
    upsertTurnTrace(turnTrace)
    return
  }

  if (decisionResult === 'no_fill') {
    appendTurnTraceEvent(turnTrace, 'ads_no_fill', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      reason: flow?.decision?.reason || '',
      reasonDetail: flow?.decision?.reasonDetail || '',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  if (decisionResult === 'blocked') {
    appendTurnTraceEvent(turnTrace, 'ads_blocked', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      reason: flow?.decision?.reason || '',
      reasonDetail: flow?.decision?.reasonDetail || '',
    })
    upsertTurnTrace(turnTrace)
    return
  }

  if (decisionResult === 'error') {
    appendTurnTraceEvent(turnTrace, 'ads_error', {
      placementKey: reportPayload.placementKey,
      requestId: flow?.requestId || '',
      reason: flow?.decision?.reason || '',
      reasonDetail: flow?.decision?.reasonDetail || '',
    })
    upsertTurnTrace(turnTrace)
  }
}

function handleSponsoredAdClick(message, ad) {
  const slot = message?.attachAdSlot
  if (!slot?.reportPayload || !message?.sourceTurnId) return

  updateTurnTrace(message.sourceTurnId, (trace) => {
    const nextTrace = { ...trace }
    nextTrace.events = [
      ...trace.events,
      {
        id: createId('event'),
        type: 'ads_click_tracked',
        at: Date.now(),
        payload: {
          adId: ad?.adId || '',
          title: ad?.title || '',
          requestId: slot.requestId || '',
          placementId: slot.placementId || '',
        },
      },
    ]
    return nextTrace
  })

  reportAdsEvent({
    ...slot.reportPayload,
    kind: 'click',
    adId: String(ad?.adId || ''),
    placementId: String(slot?.placementId || 'chat_inline_v1'),
  }).catch((error) => {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: 'ads_event_report_failed',
          at: Date.now(),
          payload: {
            kind: 'click',
            error: error instanceof Error ? error.message : 'event_report_failed',
          },
        },
      ]
      return nextTrace
    })
  })
}

function handleInlineOfferClick(message, ad) {
  handleSponsoredAdClick(message, ad)
}

function handleInlineMarkerCount(message, count) {
  if (!message || !Number.isFinite(count)) return
  const safeCount = Math.max(0, Math.floor(count))
  if (message.inlineMarkerCount === safeCount) return
  message.inlineMarkerCount = safeCount
}

function handleNextStepAdClick(message, ad) {
  const slot = message?.nextStepAdSlot
  if (!slot?.reportPayload || !message?.sourceTurnId) return
  const adId = resolveNextStepAdId(slot, ad)

  updateTurnTrace(message.sourceTurnId, (trace) => {
    const nextTrace = { ...trace }
    nextTrace.events = [
      ...trace.events,
      {
        id: createId('event'),
        type: 'ads_click_tracked',
        at: Date.now(),
        payload: {
          adId,
          title: ad?.title || '',
          requestId: slot.requestId || '',
          placementId: slot.placementId || '',
          placementKey: slot.placementKey || 'next_step.intent_card',
        },
      },
    ]
    return nextTrace
  })

  reportAdsEvent({
    ...slot.reportPayload,
    kind: 'click',
    adId,
    placementId: slot.placementId || 'chat_followup_v1',
    placementKey: slot.placementKey || 'next_step.intent_card',
  }).catch((error) => {
    updateTurnTrace(message.sourceTurnId, (trace) => {
      const nextTrace = { ...trace }
      nextTrace.events = [
        ...trace.events,
        {
          id: createId('event'),
          type: 'ads_event_report_failed',
          at: Date.now(),
          payload: {
            kind: 'click',
            adId,
            placementKey: slot.placementKey || 'next_step.intent_card',
            error: error instanceof Error ? error.message : 'event_report_failed',
          },
        },
      ]
      return nextTrace
    })
  })
}

function handleNextStepAdDismiss(message) {
  if (!message || typeof message !== 'object') return
  const slot = message.nextStepAdSlot
  if (!slot || typeof slot !== 'object') return
  if (Number.isFinite(slot.dismissedAt)) return
  const adId = resolveNextStepAdId(slot)

  slot.dismissedAt = Date.now()
  touchActiveSession()
  scheduleSaveSessions()

  if (!message.sourceTurnId) return

  updateTurnTrace(message.sourceTurnId, (trace) => {
    const nextTrace = { ...trace }
    nextTrace.events = [
      ...trace.events,
      {
        id: createId('event'),
        type: 'ads_dismissed',
        at: Date.now(),
        payload: {
          adId,
          requestId: slot.requestId || '',
          placementId: slot.placementId || '',
          placementKey: slot.placementKey || 'next_step.intent_card',
        },
      },
    ]
    return nextTrace
  })

  if (!slot.reportPayload) return

  reportAdsEvent({
    ...slot.reportPayload,
    kind: 'dismiss',
    adId,
    placementId: slot.placementId || 'chat_followup_v1',
    placementKey: slot.placementKey || 'next_step.intent_card',
  })
    .then(() => {
      updateTurnTrace(message.sourceTurnId, (trace) => {
        const nextTrace = { ...trace }
        nextTrace.events = [
          ...trace.events,
          {
            id: createId('event'),
            type: 'ads_event_reported',
            at: Date.now(),
            payload: {
              kind: 'dismiss',
              adId,
              placementKey: slot.placementKey || 'next_step.intent_card',
              requestId: slot.requestId || '',
            },
          },
        ]
        return nextTrace
      })
    })
    .catch((error) => {
      updateTurnTrace(message.sourceTurnId, (trace) => {
        const nextTrace = { ...trace }
        nextTrace.events = [
          ...trace.events,
          {
            id: createId('event'),
            type: 'ads_event_report_failed',
            at: Date.now(),
            payload: {
              kind: 'dismiss',
              adId,
              placementKey: slot.placementKey || 'next_step.intent_card',
              error: error instanceof Error ? error.message : 'event_report_failed',
            },
          },
        ]
        return nextTrace
      })
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
    inlineMarkerCount: 0,
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
      inlineMarkerCount: 0,
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
    inlineMarkerCount: 0,
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

      // Fail-open: ads pipelines run asynchronously and never block chat completion.
      runAttachAdsFlow({
        session,
        userContent,
        assistantMessageId: assistantMessage.id,
        turnTrace,
      }).catch((error) => {
        appendTurnTraceEvent(turnTrace, 'ads_evaluate_failed', {
          placementKey: 'attach.post_answer_render',
          error: error instanceof Error ? error.message : 'ads_flow_failed',
        })
        upsertTurnTrace(turnTrace)
      })

      if (ENABLE_NEXT_STEP_FLOW) {
        runNextStepIntentCardFlow({
          session,
          userContent,
          assistantMessageId: assistantMessage.id,
          turnTrace,
        }).catch((error) => {
          appendTurnTraceEvent(turnTrace, 'ads_evaluate_failed', {
            placementKey: 'next_step.intent_card',
            error: error instanceof Error ? error.message : 'ads_flow_failed',
          })
          upsertTurnTrace(turnTrace)
        })
      } else {
        appendTurnTraceEvent(turnTrace, 'next_step_skipped', {
          flow: 'next_step',
          placementKey: 'next_step.intent_card',
          reason: 'flow_disabled',
        })
        upsertTurnTrace(turnTrace)
      }
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
