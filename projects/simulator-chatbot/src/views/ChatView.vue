<template>
  <div class="flex h-screen w-full bg-white text-gray-800 font-sans overflow-hidden">
    <aside
      :class="[
        'fixed lg:relative z-40 w-[280px] h-full bg-[#f9f9f9] transition-transform duration-300 ease-in-out flex flex-col border-r border-gray-200',
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      ]"
    >
      <div class="p-3 flex flex-col gap-2 border-b border-gray-200">
        <div class="flex items-center justify-between mb-1 lg:hidden">
          <button @click="isSidebarOpen = false" class="p-2 hover:bg-gray-200 rounded-lg">
            <X :size="18" />
          </button>
        </div>

        <button
          @click="startNewChat"
          class="flex items-center justify-between w-full p-2 text-sm font-medium hover:bg-gray-200 rounded-lg transition-colors group"
        >
          <div class="flex items-center gap-2">
            <div class="p-1 rounded-full border border-gray-300 bg-white">
              <Plus :size="14" />
            </div>
            <span>New Chat</span>
          </div>
          <MessageSquare :size="14" class="opacity-0 group-hover:opacity-100 text-gray-500" />
        </button>

        <label class="flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-2 py-2 text-sm">
          <Search :size="16" class="text-gray-400" />
          <input
            v-model="historyQuery"
            type="text"
            placeholder="Search history"
            class="w-full bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          />
        </label>
      </div>

      <div class="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin">
        <div class="text-[11px] font-semibold text-gray-500 px-2 py-2 uppercase tracking-tight">Recent</div>

        <div
          v-for="session in filteredSessions"
          :key="session.id"
          :class="[
            'w-full p-2 text-sm rounded-lg relative group outline-none transition-colors',
            session.id === activeSessionId
              ? 'bg-gray-200 text-gray-900'
              : 'text-gray-700 hover:bg-gray-200'
          ]"
        >
          <button @click="openSession(session.id)" class="w-full text-left pr-9">
            <div class="truncate">{{ session.title }}</div>
            <div class="text-[11px] text-gray-500 mt-1">{{ formatSessionTime(session.updatedAt) }}</div>
          </button>
          <button
            @click.stop="deleteSession(session.id)"
            class="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex p-1 rounded hover:bg-gray-300"
            aria-label="Delete chat"
            title="Delete chat"
          >
            <Trash2 :size="14" />
          </button>
        </div>

        <div v-if="filteredSessions.length === 0" class="px-2 py-5 text-xs text-gray-500">
          No chat history.
        </div>
      </div>

      <div class="border-t border-gray-200 p-3 space-y-2">
        <div class="rounded-lg border border-gray-200 bg-white p-2">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Turn Trace</div>
          <div v-if="activeSessionTurnLogs.length === 0" class="mt-2 text-[11px] text-gray-500">
            No turn logs yet.
          </div>
          <div v-else class="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
            <details
              v-for="log in activeSessionTurnLogs"
              :key="log.turnId"
              class="rounded border border-gray-200 bg-gray-50 px-2 py-1"
            >
              <summary class="cursor-pointer list-none">
                <div class="flex items-center gap-1 text-[11px]">
                  <span class="truncate font-medium text-gray-700">{{ log.userQuery }}</span>
                  <span
                    :class="[
                      'ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      log.adOpportunityTriggered
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-200 text-gray-600'
                    ]"
                  >
                    {{ log.adOpportunityTriggered ? 'Ad: YES' : 'Ad: NO' }}
                  </span>
                </div>
                <div class="mt-1 text-[10px] text-gray-400">{{ formatTraceTime(log.startedAt) }}</div>
              </summary>

              <div class="mt-2 border-t border-gray-200 pt-2 text-[11px] text-gray-600">
                <div v-if="log.adOpportunitySources?.length" class="mb-1">
                  Sources: {{ log.adOpportunitySources.join(', ') }}
                </div>
                <ul class="space-y-1">
                  <li v-for="event in log.events" :key="event.id" class="leading-tight">
                    <span class="text-gray-400">{{ formatTraceTime(event.at) }}</span>
                    <span class="mx-1">·</span>
                    <span>{{ formatTraceEventType(event.type) }}</span>
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </div>

        <button
          @click="clearHistory"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          Clear History
        </button>
      </div>
    </aside>

    <main class="flex-1 flex flex-col h-full overflow-hidden relative bg-white">
      <header class="h-14 flex items-center justify-between px-4 shrink-0 bg-white/80 backdrop-blur-md z-30 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <button v-if="!isSidebarOpen" @click="isSidebarOpen = true" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 lg:block hidden">
            <Menu :size="20" />
          </button>
          <div class="font-semibold text-lg text-gray-700">Chat Bot</div>
        </div>

        <button @click="startNewChat" class="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors">
          New Chat
        </button>
      </header>

      <div ref="scrollRef" class="flex-1 overflow-y-auto flex flex-col">
        <div
          class="shrink-0 transition-all duration-[700ms] cubic-bezier-transition"
          :class="hasStarted ? 'max-h-0' : 'max-h-[35vh] flex-grow'"
        ></div>

        <div
          class="shrink-0 transition-all duration-[700ms] cubic-bezier-transition flex flex-col items-center"
          :class="hasStarted ? 'max-h-0 opacity-0 mb-0 scale-95 overflow-hidden' : 'max-h-20 opacity-100 mb-8 scale-100'"
        >
          <h1 class="text-3xl font-semibold text-gray-800 text-center">What can I help with?</h1>
        </div>

        <div
          class="w-full max-w-3xl mx-auto px-4 flex flex-col gap-8 transition-all duration-[700ms]"
          :class="hasStarted ? 'opacity-100 py-8' : 'opacity-0 max-h-0 overflow-hidden'"
        >
          <template v-for="msg in currentMessages" :key="msg.id">
            <div
              :class="[
                'flex gap-3 animate-in',
                msg.role === 'user' ? 'flex-row-reverse items-start' : 'flex-row items-start'
              ]"
            >
              <div class="flex-shrink-0 mt-1">
                <div
                  v-if="msg.role === 'assistant' && msg.kind !== 'tool'"
                  class="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 shadow-sm"
                >
                  <Bot :size="18" class="text-white" />
                </div>
                <div
                  v-else-if="msg.role === 'assistant' && msg.kind === 'tool'"
                  class="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center bg-gray-100 shadow-sm"
                >
                  <Search :size="16" class="text-gray-600" />
                </div>
                <div v-else class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-sm">
                  <UserCircle :size="18" class="text-white" />
                </div>
              </div>

              <div
                :class="[
                  'max-w-[75%] px-4 py-2.5 text-[16px] leading-relaxed min-h-[44px]',
                  msg.role === 'user'
                    ? 'bg-[#f4f4f4] text-gray-800 rounded-2xl rounded-tr-sm'
                    : 'bg-transparent text-gray-800 rounded-2xl rounded-tl-sm'
                ]"
              >
                <div v-if="msg.role === 'user'" class="whitespace-pre-wrap leading-normal">{{ msg.content }}</div>

                <div v-else class="leading-normal">
                  <template v-if="msg.kind === 'tool'">
                    <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                      <div class="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                        <span class="font-semibold">Tool</span>
                        <span class="rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700">web_search</span>
                        <span class="ml-auto normal-case text-[11px] font-medium text-gray-600">{{ formatToolState(msg.toolState) }}</span>
                      </div>

                      <div v-if="msg.toolQuery" class="mt-2 text-[13px] text-gray-600">
                        Query: "{{ msg.toolQuery }}"
                      </div>

                      <div v-if="msg.toolState === 'running'" class="mt-2 inline-flex items-center gap-2 text-gray-500 text-xs">
                        <LoaderCircle :size="12" class="animate-spin" />
                        <span>Searching web...</span>
                      </div>

                      <div v-if="msg.toolState === 'error'" class="mt-2 text-xs text-red-600">
                        {{ msg.toolError || 'Tool execution failed.' }}
                      </div>

                      <div v-if="msg.toolState === 'done' && msg.toolLatencyMs !== null" class="mt-2 text-[11px] text-gray-500">
                        Finished in {{ msg.toolLatencyMs }} ms
                      </div>

                      <div v-if="msg.sponsoredSlot?.ad" class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                          <span>{{ msg.sponsoredSlot.label || 'Sponsored' }}</span>
                          <span class="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-800">Slot 1</span>
                        </div>
                        <a
                          :href="msg.sponsoredSlot.ad.url"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="mt-1 block text-sm font-medium text-amber-900 hover:underline"
                        >
                          {{ msg.sponsoredSlot.ad.title }}
                        </a>
                        <p class="mt-1 text-xs text-amber-800">{{ msg.sponsoredSlot.ad.snippet }}</p>
                        <p class="mt-1 text-[11px] text-amber-700">
                          {{ msg.sponsoredSlot.ad.advertiser }}
                        </p>
                      </div>

                      <ul v-if="msg.toolResults?.length" class="mt-2 space-y-2">
                        <li v-for="(result, idx) in msg.toolResults" :key="result.id || idx" class="rounded-lg border border-gray-200 bg-white p-2">
                          <a :href="result.url" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-blue-700 hover:underline">
                            {{ idx + 1 }}. {{ result.title }}
                          </a>
                          <p class="mt-1 text-xs text-gray-600">{{ result.snippet }}</p>
                          <p class="mt-1 text-[11px] text-gray-400">{{ getHostLabel(result.url) }}</p>
                        </li>
                      </ul>
                    </div>
                  </template>

                  <template v-else-if="msg.status === 'reasoning' && !msg.content">
                    <div class="inline-flex items-center gap-2 text-gray-500 text-sm">
                      <LoaderCircle :size="14" class="animate-spin" />
                      <span>Reasoning...</span>
                    </div>
                  </template>

                  <template v-if="msg.kind !== 'tool' && msg.content">
                    <MarkdownRenderer :content="msg.content" />
                    <span v-if="msg.status === 'streaming'" class="inline-block w-0.5 h-5 bg-gray-800 ml-0.5 cursor-blink align-middle"></span>
                  </template>

                  <FollowUpSuggestions
                    v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.followUps?.length"
                    :items="msg.followUps"
                    :disabled="isLoading"
                    @select="handleFollowUpSelect"
                  />
                </div>
              </div>
            </div>
          </template>

          <div class="h-4"></div>
        </div>

        <div
          class="w-full sticky bottom-0 bg-white z-20 transition-all duration-[700ms] cubic-bezier-transition"
          :class="hasStarted ? 'mt-auto pb-6 pt-2' : 'pb-8'"
        >
          <div class="max-w-3xl mx-auto px-4">
            <div class="relative flex flex-col bg-[#f4f4f4] rounded-[26px] p-2 border border-transparent focus-within:border-gray-200 transition-all duration-300">
              <textarea
                rows="1"
                v-model="input"
                @compositionstart="isComposing = true"
                @compositionend="isComposing = false"
                @keydown.enter.prevent="handleSend"
                placeholder="Message Chat Bot"
                class="w-full bg-transparent border-none focus:ring-0 focus:outline-none outline-none resize-none py-3 pl-4 pr-24 text-[16px] max-h-52 placeholder:text-gray-500"
                style="min-height: 44px"
              ></textarea>

              <div class="flex items-center justify-end px-2 pb-1">
                <button
                  @click="handleSend"
                  :disabled="!input.trim() || isLoading"
                  :class="[
                    'p-2 rounded-full transition-all outline-none',
                    input.trim() && !isLoading ? 'bg-black text-white hover:bg-gray-800' : 'bg-gray-300 text-gray-100 cursor-not-allowed'
                  ]"
                >
                  <ArrowUp :size="18" :stroke-width="3" />
                </button>
              </div>
            </div>

            <div class="mt-3 text-center">
              <p class="text-[11px] text-gray-500 select-none">Chat Bot can make mistakes. Check important info.</p>
            </div>
          </div>
        </div>

        <div
          class="shrink-0 transition-all duration-[700ms] cubic-bezier-transition"
          :class="hasStarted ? 'max-h-0' : 'max-h-[25vh] flex-grow'"
        ></div>
      </div>
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
  Trash2,
  Menu,
  ArrowUp,
  Bot,
  UserCircle,
  LoaderCircle,
} from 'lucide-vue-next'
import { sendMessageStream } from '../api/deepseek'
import { shouldUseWebSearchTool, runWebSearchTool, buildWebSearchContext } from '../api/webSearchTool'
import FollowUpSuggestions from '../components/FollowUpSuggestions.vue'
import MarkdownRenderer from '../components/MarkdownRenderer.vue'

const STORAGE_KEY = 'chat_bot_history_v2'
const LEGACY_STORAGE_KEYS = ['chat_bot_sessions_v1']
const MAX_SESSIONS = 50
const TOOL_STATES = ['planning', 'running', 'done', 'error']
const TURN_LOG_STORAGE_KEY = 'chat_bot_turn_logs_v1'
const MAX_TURN_LOGS = 400
const FOLLOW_UP_SPONSORED_OPTIONS = [
  {
    adId: 'sponsored_followup_vercel_ai_sdk',
    advertiser: 'Vercel',
    text: 'Want a faster way to ship this as an AI app?',
    prompt: 'Recommend a practical way to ship this as an AI app with fast iteration.',
    keywords: ['app', 'deploy', 'ship', 'frontend', 'product'],
  },
  {
    adId: 'sponsored_followup_pinecone_rag',
    advertiser: 'Pinecone',
    text: 'Need retrieval support for this workflow?',
    prompt: 'What retrieval architecture should I use if I need scalable RAG for this?',
    keywords: ['search', 'retrieval', 'rag', 'knowledge', 'memory'],
  },
  {
    adId: 'sponsored_followup_github_copilot',
    advertiser: 'GitHub',
    text: 'Want coding assistance for implementation?',
    prompt: 'Suggest an efficient implementation plan and coding workflow for this.',
    keywords: ['code', 'implement', 'sdk', 'developer', 'engineering'],
  },
]

const input = ref('')
const historyQuery = ref('')
const isSidebarOpen = ref(true)
const scrollRef = ref(null)
const isLoading = ref(false)
const isComposing = ref(false)

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
    createdAt: now,
    updatedAt: now,
    messages: [],
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
    isSponsored: Boolean(raw.isSponsored),
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Sponsored',
    adId: typeof raw.adId === 'string' ? raw.adId : '',
    advertiser: typeof raw.advertiser === 'string' ? raw.advertiser : '',
    sourceTurnId: typeof raw.sourceTurnId === 'string' ? raw.sourceTurnId : '',
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

function normalizeTurnLog(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.turnId !== 'string' || !raw.turnId) return null
  if (typeof raw.sessionId !== 'string' || !raw.sessionId) return null

  return {
    turnId: raw.turnId,
    traceId: typeof raw.traceId === 'string' ? raw.traceId : '',
    sessionId: raw.sessionId,
    userQuery: typeof raw.userQuery === 'string' ? raw.userQuery : '',
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : Date.now(),
    endedAt: Number.isFinite(raw.endedAt) ? raw.endedAt : null,
    adOpportunityTriggered: Boolean(raw.adOpportunityTriggered),
    adOpportunitySources: Array.isArray(raw.adOpportunitySources)
      ? raw.adOpportunitySources.filter((item) => typeof item === 'string')
      : [],
    events: Array.isArray(raw.events)
      ? raw.events
          .map((event, index) => normalizeTurnEvent(event, index))
          .filter(Boolean)
      : [],
  }
}

function normalizeSponsoredSlot(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.ad || typeof raw.ad !== 'object') return null

  return {
    slotId: typeof raw.slotId === 'string' ? raw.slotId : 'search_sponsored_slot_1',
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Sponsored',
    ad: {
      id: typeof raw.ad.id === 'string' ? raw.ad.id : '',
      title: typeof raw.ad.title === 'string' ? raw.ad.title : '',
      url: typeof raw.ad.url === 'string' ? raw.ad.url : '',
      snippet: typeof raw.ad.snippet === 'string' ? raw.ad.snippet : '',
      advertiser: typeof raw.ad.advertiser === 'string' ? raw.ad.advertiser : '',
    },
  }
}

function normalizeMessage(raw) {
  if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) return null

  const toolState = TOOL_STATES.includes(raw.toolState) ? raw.toolState : 'done'
  const toolResults = Array.isArray(raw.toolResults)
    ? raw.toolResults
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' ? item.id : `tool_result_${index}`,
          title: typeof item.title === 'string' ? item.title : '',
          url: typeof item.url === 'string' ? item.url : '',
          snippet: typeof item.snippet === 'string' ? item.snippet : '',
        }))
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
    sponsoredSlot: normalizeSponsoredSlot(raw.sponsoredSlot),
    followUps: Array.isArray(raw.followUps)
      ? raw.followUps
          .map((item, index) => normalizeFollowUpItem(item, index))
          .filter(Boolean)
      : [],
  }
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null

  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeMessage).filter(Boolean)
    : []

  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('session'),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'New Chat',
    createdAt,
    updatedAt,
    messages,
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
    const normalized = rawSessions.map(normalizeSession).filter(Boolean)

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

loadSessions()

function loadTurnLogs() {
  try {
    const raw = localStorage.getItem(TURN_LOG_STORAGE_KEY)
    if (!raw) {
      turnLogs.value = []
      return
    }

    const parsed = JSON.parse(raw)
    const records = Array.isArray(parsed) ? parsed : []
    turnLogs.value = records.map(normalizeTurnLog).filter(Boolean).slice(0, MAX_TURN_LOGS)
  } catch (error) {
    console.error('Failed to load turn logs:', error)
    turnLogs.value = []
  }
}

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

function createTurnTrace(sessionId, userQuery) {
  const now = Date.now()
  return {
    turnId: createId('turn'),
    traceId: createId('trace'),
    sessionId,
    userQuery,
    startedAt: now,
    endedAt: null,
    adOpportunityTriggered: false,
    adOpportunitySources: [],
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
  try {
    const host = new URL(url).hostname
    return host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function buildModelMessages(messages, webSearchContext) {
  const modelMessages = messages
    .filter((msg) => {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return false
      if (msg.kind === 'tool') return false
      return typeof msg.content === 'string' && msg.content.trim().length > 0
    })
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))

  if (webSearchContext) {
    modelMessages.push({
      role: 'assistant',
      content: `[Tool:web_search]\n${webSearchContext}`,
    })
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

function pickSponsoredFollowUp(userContent, assistantContent) {
  const context = `${userContent || ''} ${assistantContent || ''}`.toLowerCase()
  const matched = FOLLOW_UP_SPONSORED_OPTIONS.find((option) => {
    return option.keywords.some((keyword) => context.includes(keyword))
  })
  return matched || FOLLOW_UP_SPONSORED_OPTIONS[0]
}

function createFollowUpSuggestions(userContent, assistantContent, sourceTurnId = '') {
  const topicSeed = extractTopicSeed(userContent) || extractTopicSeed(assistantContent) || 'this topic'

  const suggestions = [
    {
      id: createId('followup'),
      text: 'Can you break this into practical steps?',
      prompt: `Break down "${topicSeed}" into practical implementation steps.`,
      isSponsored: false,
      label: '',
      adId: '',
      advertiser: '',
      sourceTurnId,
    },
    {
      id: createId('followup'),
      text: 'What are the main trade-offs here?',
      prompt: `What are the main trade-offs and risks for "${topicSeed}"?`,
      isSponsored: false,
      label: '',
      adId: '',
      advertiser: '',
      sourceTurnId,
    },
    {
      id: createId('followup'),
      text: 'Can you give me one concrete example?',
      prompt: `Give one concrete example for "${topicSeed}" with expected output.`,
      isSponsored: false,
      label: '',
      adId: '',
      advertiser: '',
      sourceTurnId,
    },
  ]

  const sponsored = pickSponsoredFollowUp(userContent, assistantContent)
  suggestions.push({
    id: createId('followup'),
    text: sponsored.text,
    prompt: sponsored.prompt,
    isSponsored: true,
    label: 'Sponsored',
    adId: sponsored.adId,
    advertiser: sponsored.advertiser,
    sourceTurnId,
  })

  return suggestions
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
  activeSessionId.value = sessionId
  scrollToBottom()
}

function startNewChat() {
  const newSession = createSession()
  sessions.value = [newSession, ...sessions.value].slice(0, MAX_SESSIONS)
  activeSessionId.value = newSession.id
  historyQuery.value = ''
  persistSessionsNow()
}

function deleteSession(sessionId) {
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

  sessions.value = [createSession()]
  activeSessionId.value = sessions.value[0].id
  historyQuery.value = ''
  persistSessionsNow()
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
          type: item.isSponsored ? 'sponsored_follow_up_clicked' : 'follow_up_clicked',
          at: Date.now(),
          payload: {
            text: item.text,
            adId: item.adId || '',
            isSponsored: Boolean(item.isSponsored),
          },
        },
      ]
      return nextTrace
    })
  }

  input.value = item.prompt
  await handleSend()
}

async function handleSend() {
  if (!input.value.trim() || isLoading.value || isComposing.value) return

  const session = activeSession.value
  if (!session) return

  const userContent = input.value.trim()
  input.value = ''
  isLoading.value = true
  const turnTrace = createTurnTrace(session.id, userContent)
  appendTurnTraceEvent(turnTrace, 'turn_started', { query: userContent })
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
    sponsoredSlot: null,
    followUps: [],
  }

  session.messages.push(userMessage)
  updateTitleFromFirstMessage(session, userContent)
  touchActiveSession()
  scheduleSaveSessions()
  appendTurnTraceEvent(turnTrace, 'user_message_added')
  upsertTurnTrace(turnTrace)

  let webSearchContext = ''

  if (shouldUseWebSearchTool(userContent)) {
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
      sponsoredSlot: null,
      followUps: [],
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
      toolMessage.sponsoredSlot = normalizeSponsoredSlot(webSearchOutput.sponsoredSlot)
      const sponsoredCount = toolMessage.sponsoredSlot?.ad ? 1 : 0
      toolMessage.content = `web_search returned ${webSearchOutput.results.length} results (+${sponsoredCount} sponsored slot)`
      appendTurnTraceEvent(turnTrace, 'web_search_succeeded', {
        organicCount: webSearchOutput.results.length,
        sponsoredCount,
        latencyMs: webSearchOutput.latencyMs,
      })
      if (sponsoredCount > 0) {
        appendTurnTraceEvent(turnTrace, 'sponsored_slot_rendered', {
          slotId: toolMessage.sponsoredSlot?.slotId || 'search_sponsored_slot_1',
          adId: toolMessage.sponsoredSlot?.ad?.id || '',
        })
      }
      upsertTurnTrace(turnTrace)
      webSearchContext = buildWebSearchContext(
        webSearchOutput.query,
        webSearchOutput.results,
        webSearchOutput.sponsoredSlot,
      )
    } catch (error) {
      toolMessage.toolState = 'error'
      toolMessage.toolError = error instanceof Error ? error.message : 'Tool execution failed'
      toolMessage.content = 'web_search failed'
      toolMessage.sponsoredSlot = null
      toolMessage.followUps = []
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
    sponsoredSlot: null,
    followUps: [],
  }

  session.messages.push(assistantMessage)
  touchActiveSession()
  scheduleSaveSessions()
  appendTurnTraceEvent(turnTrace, 'assistant_generation_started')
  upsertTurnTrace(turnTrace)

  const modelMessages = buildModelMessages(session.messages, webSearchContext)

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
      assistantMessage.followUps = createFollowUpSuggestions(
        userContent,
        assistantMessage.content,
        turnTrace.turnId,
      )
      const sponsoredFollowUps = assistantMessage.followUps.filter((item) => item.isSponsored).length
      appendTurnTraceEvent(turnTrace, 'assistant_generation_completed', {
        responseLength: assistantMessage.content.length,
      })
      appendTurnTraceEvent(turnTrace, 'follow_up_generated', {
        count: assistantMessage.followUps.length,
        sponsoredCount: sponsoredFollowUps,
      })

      const adOpportunitySources = []
      if (turnTrace.events.some((event) => event.type === 'sponsored_slot_rendered')) {
        adOpportunitySources.push('web_search_sponsored_slot')
      }
      if (sponsoredFollowUps > 0) {
        adOpportunitySources.push('follow_up_sponsored')
      }

      turnTrace.adOpportunityTriggered = adOpportunitySources.length > 0
      turnTrace.adOpportunitySources = adOpportunitySources
      turnTrace.endedAt = Date.now()
      appendTurnTraceEvent(turnTrace, 'ad_opportunity_evaluated', {
        triggered: turnTrace.adOpportunityTriggered,
        sources: adOpportunitySources,
      })
      upsertTurnTrace(turnTrace)
      touchActiveSession()
      scheduleSaveSessions()
      isLoading.value = false
    },
    (error) => {
      assistantMessage.status = 'done'
      assistantMessage.content = `Sorry, an error occurred: ${error}`
      assistantMessage.followUps = []
      appendTurnTraceEvent(turnTrace, 'assistant_generation_failed', {
        error: assistantMessage.content,
      })
      const adOpportunitySources = turnTrace.events.some((event) => event.type === 'sponsored_slot_rendered')
        ? ['web_search_sponsored_slot']
        : []
      turnTrace.adOpportunityTriggered = adOpportunitySources.length > 0
      turnTrace.adOpportunitySources = adOpportunitySources
      turnTrace.endedAt = Date.now()
      appendTurnTraceEvent(turnTrace, 'ad_opportunity_evaluated', {
        triggered: turnTrace.adOpportunityTriggered,
        sources: adOpportunitySources,
      })
      upsertTurnTrace(turnTrace)
      touchActiveSession()
      scheduleSaveSessions()
      isLoading.value = false
      console.error('DeepSeek API Error:', error)
    },
  )
}
</script>
