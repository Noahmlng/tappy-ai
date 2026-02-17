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

      <div class="border-t border-gray-200 p-3">
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
                <div v-if="msg.role === 'assistant'" class="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 shadow-sm">
                  <Bot :size="18" class="text-white" />
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
                  <template v-if="msg.status === 'reasoning' && !msg.content">
                    <div class="inline-flex items-center gap-2 text-gray-500 text-sm">
                      <LoaderCircle :size="14" class="animate-spin" />
                      <span>Reasoning...</span>
                    </div>
                  </template>

                  <template v-if="msg.content">
                    <MarkdownRenderer :content="msg.content" />
                    <span v-if="msg.status === 'streaming'" class="inline-block w-0.5 h-5 bg-gray-800 ml-0.5 cursor-blink align-middle"></span>
                  </template>
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
import MarkdownRenderer from '../components/MarkdownRenderer.vue'

const STORAGE_KEY = 'chat_bot_history_v2'
const LEGACY_STORAGE_KEYS = ['chat_bot_sessions_v1']
const MAX_SESSIONS = 50

const input = ref('')
const historyQuery = ref('')
const isSidebarOpen = ref(true)
const scrollRef = ref(null)
const isLoading = ref(false)
const isComposing = ref(false)

const sessions = ref([])
const activeSessionId = ref('')

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

function normalizeMessage(raw) {
  if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('msg'),
    role: raw.role,
    content: typeof raw.content === 'string' ? raw.content : '',
    status: raw.status === 'reasoning' || raw.status === 'streaming' ? raw.status : 'done',
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

async function handleSend() {
  if (!input.value.trim() || isLoading.value || isComposing.value) return

  const session = activeSession.value
  if (!session) return

  const userContent = input.value.trim()
  input.value = ''
  isLoading.value = true

  const userMessage = {
    id: createId('msg'),
    role: 'user',
    content: userContent,
    status: 'done',
  }

  session.messages.push(userMessage)
  updateTitleFromFirstMessage(session, userContent)

  const assistantMessage = {
    id: createId('msg'),
    role: 'assistant',
    content: '',
    status: 'reasoning',
  }

  session.messages.push(assistantMessage)
  touchActiveSession()
  scheduleSaveSessions()

  await sendMessageStream(
    session.messages,
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
      touchActiveSession()
      scheduleSaveSessions()
      isLoading.value = false
    },
    (error) => {
      assistantMessage.status = 'done'
      assistantMessage.content = `Sorry, an error occurred: ${error}`
      touchActiveSession()
      scheduleSaveSessions()
      isLoading.value = false
      console.error('DeepSeek API Error:', error)
    },
  )
}
</script>
