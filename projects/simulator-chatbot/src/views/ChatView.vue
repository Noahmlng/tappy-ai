<template>
  <div class="flex h-screen w-full overflow-hidden bg-[#f7f7f8] font-sans text-[#1f1f1f]">
    <aside
      :class="[
        'fixed z-40 flex h-full w-[260px] -translate-x-full flex-col border-r border-[#2a2a2a] bg-[var(--chat-sidebar-bg)] text-[var(--chat-sidebar-text)] transition-transform duration-300 ease-in-out lg:relative lg:z-0 lg:translate-x-0',
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      ]"
    >
      <div class="border-b border-[var(--chat-sidebar-border)] p-3">
        <div class="mb-2 flex items-center justify-between lg:hidden">
          <button @click="isSidebarOpen = false" class="rounded-lg p-2 text-[var(--chat-sidebar-muted)] hover:bg-[#262626]">
            <X :size="18" />
          </button>
        </div>

        <button
          @click="startNewChat"
          class="group flex w-full items-center justify-between rounded-xl border border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-surface)] p-2 text-sm font-medium transition-colors hover:bg-[#2b2b2b]"
        >
          <div class="flex items-center gap-2">
            <div class="rounded-full border border-[#3a3a3a] bg-[#151515] p-1">
              <Plus :size="14" />
            </div>
            <span>New Chat</span>
          </div>
          <MessageSquare :size="14" class="text-[var(--chat-sidebar-muted)] opacity-0 group-hover:opacity-100" />
        </button>

        <label class="mt-2 flex items-center gap-2 rounded-xl border border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-surface)] px-2 py-2 text-sm">
          <Search :size="16" class="text-[var(--chat-sidebar-muted)]" />
          <input
            v-model="historyQuery"
            type="text"
            placeholder="Search history"
            class="w-full bg-transparent text-[var(--chat-sidebar-text)] outline-none placeholder:text-[var(--chat-sidebar-muted)]"
          />
        </label>
      </div>

      <div class="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-2">
        <div class="px-2 py-2 text-[11px] font-semibold uppercase tracking-tight text-[var(--chat-sidebar-muted)]">Recent</div>

        <div
          v-for="session in filteredSessions"
          :key="session.id"
          :class="[
            'group relative w-full rounded-lg p-2 text-sm outline-none transition-colors',
            session.id === activeSessionId
              ? 'bg-[#2f2f2f] text-white'
              : 'text-[var(--chat-sidebar-text)] hover:bg-[#262626]'
          ]"
        >
          <button @click="openSession(session.id)" class="w-full pr-9 text-left">
            <div class="truncate">{{ session.title }}</div>
            <div class="mt-1 text-[11px] text-[var(--chat-sidebar-muted)]">{{ formatSessionTime(session.updatedAt) }}</div>
          </button>
          <button
            @click.stop="deleteSession(session.id)"
            class="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-1 text-[var(--chat-sidebar-muted)] hover:bg-[#3a3a3a] group-hover:flex"
            aria-label="Delete chat"
            title="Delete chat"
          >
            <Trash2 :size="14" />
          </button>
        </div>

        <div v-if="filteredSessions.length === 0" class="px-2 py-5 text-xs text-[var(--chat-sidebar-muted)]">
          No chat history.
        </div>
      </div>

      <div class="space-y-2 border-t border-[var(--chat-sidebar-border)] p-3">
        <details class="rounded-xl border border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-surface)] p-2">
          <summary class="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-sidebar-muted)]">
            System Prompt
          </summary>
          <div class="mt-2 flex items-center justify-end">
            <button
              class="rounded border border-[#3a3a3a] px-1.5 py-0.5 text-[10px] text-[var(--chat-sidebar-muted)] hover:bg-[#2d2d2d] disabled:opacity-60"
              :disabled="!activeSession"
              @click="resetActiveSystemPrompt"
            >
              Reset
            </button>
          </div>
          <textarea
            v-model="activeSystemPrompt"
            :disabled="!activeSession"
            rows="5"
            class="mt-2 w-full resize-y rounded-lg border border-[#3a3a3a] bg-[#1b1b1b] px-2 py-1.5 text-[12px] text-[var(--chat-sidebar-text)] outline-none focus:border-[#5a5a5a] disabled:opacity-60"
            placeholder="Set a per-chat system prompt..."
          ></textarea>
          <div class="mt-1 text-[10px] text-[var(--chat-sidebar-muted)]">
            Applied to every request in the current chat. New Chat resets to default.
          </div>
        </details>

        <details class="rounded-xl border border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-surface)] p-2">
          <summary class="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-sidebar-muted)]">
            Turn Trace
          </summary>
          <div v-if="activeSessionTurnLogs.length === 0" class="mt-2 text-[11px] text-[var(--chat-sidebar-muted)]">
            No turn logs yet.
          </div>
          <div v-else class="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
            <details
              v-for="log in activeSessionTurnLogs"
              :key="log.turnId"
              class="rounded border border-[#333333] bg-[#1a1a1a] px-2 py-1"
            >
              <summary class="list-none cursor-pointer">
                <div class="flex items-center gap-1 text-[11px]">
                  <span class="truncate font-medium text-[var(--chat-sidebar-text)]">{{ log.userQuery }}</span>
                  <span
                    :class="[
                      'ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      log.toolUsed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-[#303030] text-[var(--chat-sidebar-muted)]'
                    ]"
                  >
                    {{ log.toolUsed ? 'Tool: YES' : 'Tool: NO' }}
                  </span>
                </div>
                <div class="mt-1 text-[10px] text-[var(--chat-sidebar-muted)]">{{ formatTraceTime(log.startedAt) }}</div>
              </summary>

              <div class="mt-2 border-t border-[#333333] pt-2 text-[11px] text-[var(--chat-sidebar-text)]">
                <div class="mb-1 text-[10px] text-[var(--chat-sidebar-muted)]">Retry count: {{ log.retryCount || 0 }}</div>
                <ul class="space-y-1">
                  <li v-for="event in log.events" :key="event.id" class="leading-tight">
                    <span class="text-[var(--chat-sidebar-muted)]">{{ formatTraceTime(event.at) }}</span>
                    <span class="mx-1">·</span>
                    <span>{{ formatTraceEventType(event.type) }}</span>
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </details>

        <button
          @click="clearHistory"
          class="w-full rounded-xl border border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-surface)] px-3 py-2 text-xs font-medium text-[var(--chat-sidebar-text)] hover:bg-[#2b2b2b]"
        >
          Clear History
        </button>
      </div>
    </aside>

    <main class="relative flex h-full flex-1 flex-col overflow-hidden bg-[var(--chat-main-bg)]">
      <header class="z-30 flex h-14 shrink-0 items-center justify-between border-b border-[#ececec] bg-white/90 px-4 backdrop-blur-md">
        <div class="flex items-center gap-2">
          <button
            v-if="!isSidebarOpen"
            @click="isSidebarOpen = true"
            class="hidden rounded-lg p-2 text-[#6b6b6b] hover:bg-[#f2f2f2] lg:block"
          >
            <Menu :size="20" />
          </button>
          <div class="rounded-full border border-[#e5e7eb] px-2.5 py-1 text-xs font-medium text-[#5f6368]">Chat Bot</div>
        </div>

        <button
          @click="startNewChat"
          class="inline-flex items-center gap-1 rounded-full border border-[#dddddd] px-2.5 py-1 text-xs font-medium text-[#3f3f46] transition-colors hover:bg-[#f5f5f5]"
        >
          <Plus :size="13" />
          <span>New</span>
        </button>
      </header>

      <div ref="scrollRef" class="flex flex-1 flex-col overflow-y-auto">
        <div
          class="cubic-bezier-transition shrink-0 transition-all duration-[700ms]"
          :class="hasStarted ? 'max-h-0' : 'max-h-[35vh] flex-grow'"
        ></div>

        <div
          class="cubic-bezier-transition shrink-0 flex flex-col items-center transition-all duration-[700ms]"
          :class="hasStarted ? 'mb-0 max-h-0 scale-95 overflow-hidden opacity-0' : 'mb-8 max-h-20 scale-100 opacity-100'"
        >
          <h1 class="text-center text-[34px] font-semibold tracking-tight text-[#202123]">How can I help you today?</h1>
        </div>

        <div
          class="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 transition-all duration-[700ms]"
          :class="hasStarted ? 'py-8 opacity-100' : 'max-h-0 overflow-hidden opacity-0'"
        >
          <template v-for="msg in currentMessages" :key="msg.id">
            <div
              :class="[
                'animate-in flex gap-3',
                msg.role === 'user' ? 'flex-row-reverse items-start' : 'flex-row items-start'
              ]"
            >
              <div class="mt-1 flex-shrink-0">
                <div
                  v-if="msg.role === 'assistant' && msg.kind !== 'tool'"
                  class="flex h-8 w-8 items-center justify-center rounded-full border border-[#0f8f70] bg-[#10a37f] shadow-sm"
                >
                  <Bot :size="18" class="text-white" />
                </div>
                <div
                  v-else-if="msg.role === 'assistant' && msg.kind === 'tool'"
                  class="flex h-8 w-8 items-center justify-center rounded-full border border-[#d7d7d7] bg-[#f4f4f4] shadow-sm"
                >
                  <Search :size="16" class="text-[#5f6368]" />
                </div>
                <div
                  v-else
                  class="flex h-8 w-8 items-center justify-center rounded-full bg-[#ececec] shadow-sm"
                >
                  <UserCircle :size="18" class="text-[#737373]" />
                </div>
              </div>

              <div
                :class="[
                  'min-h-[44px] max-w-[78%] px-4 py-2.5 text-[15px] leading-7',
                  msg.role === 'user'
                    ? 'rounded-3xl rounded-tr-md border border-[#ececec] bg-[#f4f4f4] text-[#202123]'
                    : 'rounded-2xl rounded-tl-sm bg-transparent text-[#202123]'
                ]"
              >
                <div v-if="msg.role === 'user'" class="leading-normal">
                  <template v-if="queryRewriteMessageId === msg.id">
                    <textarea
                      v-model="queryRewriteDraft"
                      rows="2"
                      class="w-full resize-y rounded-xl border border-[#d8d8d8] bg-white px-3 py-2 text-[14px] leading-normal text-[#202123] outline-none focus:border-[#b8b8b8]"
                      @keydown.esc.prevent="cancelQueryRewriteEdit"
                    ></textarea>
                    <div class="mt-2 flex items-center justify-end gap-2">
                      <button
                        class="rounded-lg border border-[#d1d1d1] px-2 py-1 text-[11px] text-[#52525b] hover:bg-[#f3f4f6]"
                        @click="cancelQueryRewriteEdit"
                      >
                        Cancel
                      </button>
                      <button
                        class="rounded-lg border border-[#111111] bg-[#111111] px-2 py-1 text-[11px] text-white hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="!queryRewriteDraft.trim() || isLoading"
                        @click="submitQueryRewrite(msg)"
                      >
                        Rewrite & Run
                      </button>
                    </div>
                  </template>

                  <template v-else>
                    <div class="whitespace-pre-wrap">{{ msg.content }}</div>
                    <div class="mt-2 flex justify-end">
                      <button
                        class="inline-flex items-center gap-1 rounded-lg border border-[#d7d7d7] bg-white px-2 py-1 text-[11px] text-[#5f6368] hover:bg-[#f6f7f8] disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="isLoading"
                        @click="startQueryRewriteEdit(msg)"
                      >
                        <PenSquare :size="12" />
                        <span>Edit & Rewrite</span>
                      </button>
                    </div>
                  </template>
                </div>

                <div v-else class="leading-normal">
                  <template v-if="msg.kind === 'tool'">
                    <div class="rounded-2xl border border-[#e6e6e6] bg-[#fafafa] px-3 py-2 text-sm">
                      <div class="flex items-center gap-2 text-xs uppercase tracking-wide text-[#6b7280]">
                        <span class="font-semibold">Tool</span>
                        <span class="rounded-md bg-[#ececec] px-1.5 py-0.5 text-[10px] text-[#4b5563]">web_search</span>
                        <span class="ml-auto text-[11px] font-medium normal-case text-[#5f6368]">{{ formatToolState(msg.toolState) }}</span>
                      </div>

                      <div v-if="msg.toolQuery" class="mt-2 text-[13px] text-[#4b5563]">Query: "{{ msg.toolQuery }}"</div>

                      <div v-if="msg.toolState === 'running'" class="mt-2 inline-flex items-center gap-2 text-xs text-[#6b7280]">
                        <LoaderCircle :size="12" class="animate-spin" />
                        <span>Searching web...</span>
                      </div>

                      <div v-if="msg.toolState === 'error'" class="mt-2 text-xs text-red-600">
                        {{ msg.toolError || 'Tool execution failed.' }}
                      </div>

                      <div v-if="msg.toolState === 'done' && msg.toolLatencyMs !== null" class="mt-2 text-[11px] text-[#6b7280]">
                        Finished in {{ msg.toolLatencyMs }} ms
                      </div>

                      <ul v-if="msg.toolResults?.length" class="mt-2 space-y-2">
                        <li v-for="(result, idx) in msg.toolResults" :key="result.id || idx" class="rounded-xl border border-[#e7e7e7] bg-white p-2">
                          <a
                            :href="result.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-sm font-medium text-[#2f5bd3] hover:underline"
                          >
                            {{ idx + 1 }}. {{ result.title }}
                          </a>
                          <p class="mt-1 text-xs text-[#4b5563]">{{ result.snippet }}</p>
                          <p class="mt-1 text-[11px] text-[#9ca3af]">{{ getHostLabel(result.url) }}</p>
                        </li>
                      </ul>
                    </div>
                  </template>

                  <template v-else-if="msg.status === 'reasoning' && !msg.content">
                    <div class="inline-flex items-center gap-2 text-sm text-[#6b7280]">
                      <LoaderCircle :size="14" class="animate-spin" />
                      <span>Reasoning...</span>
                    </div>
                  </template>

                  <template v-if="msg.kind !== 'tool' && msg.content">
                    <MarkdownRenderer :content="msg.content" />
                    <span
                      v-if="msg.status === 'streaming'"
                      class="cursor-blink ml-0.5 inline-block h-5 w-0.5 bg-gray-800 align-middle"
                    ></span>
                  </template>

                  <div
                    v-if="msg.kind !== 'tool' && msg.role === 'assistant' && msg.status === 'done' && msg.sourceUserContent"
                    class="mt-2 flex items-center gap-2"
                  >
                    <button
                      class="rounded-lg border border-[#d8d8d8] bg-white px-2 py-1 text-[11px] text-[#5f6368] hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="isLoading"
                      @click="handleRegenerate(msg)"
                    >
                      Regenerate
                    </button>
                    <span class="text-[10px] text-[#9ca3af]">Retry #{{ msg.retryCount }}</span>
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
                </div>
              </div>
            </div>
          </template>

          <div class="h-4"></div>
        </div>

        <div
          class="cubic-bezier-transition sticky bottom-0 z-20 w-full bg-gradient-to-t from-white via-white to-white/90 transition-all duration-[700ms]"
          :class="hasStarted ? 'mt-auto pb-5 pt-2' : 'pb-8'"
        >
          <div class="mx-auto max-w-[760px] px-4">
            <div class="relative flex flex-col rounded-[28px] border border-[#d9d9e3] bg-white p-2 shadow-[0_10px_30px_rgba(0,0,0,0.06)] transition-all duration-300 focus-within:border-[#c9c9d7]">
              <textarea
                v-model="input"
                rows="1"
                @compositionstart="isComposing = true"
                @compositionend="isComposing = false"
                @keydown.enter.prevent="handleSend"
                placeholder="Message Chat Bot"
                class="max-h-52 w-full resize-none border-none bg-transparent py-3 pl-4 pr-24 text-[16px] text-[#202123] outline-none focus:outline-none focus:ring-0 placeholder:text-[#9ca3af]"
                style="min-height: 44px"
              ></textarea>

              <div class="flex items-center justify-end px-2 pb-1">
                <button
                  @click="handleSend"
                  :disabled="!input.trim() || isLoading"
                  :class="[
                    'rounded-full p-2.5 outline-none transition-all',
                    input.trim() && !isLoading ? 'bg-[#111111] text-white hover:bg-[#2a2a2a]' : 'cursor-not-allowed bg-[#ebebeb] text-[#b8b8b8]'
                  ]"
                >
                  <ArrowUp :size="18" :stroke-width="3" />
                </button>
              </div>
            </div>

            <div class="mt-3 text-center">
              <p class="select-none text-[11px] text-[#8f8f95]">Chat Bot can make mistakes. Check important info.</p>
            </div>
          </div>
        </div>

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
import {
  X,
  Plus,
  MessageSquare,
  Search,
  PenSquare,
  Trash2,
  Menu,
  ArrowUp,
  Bot,
  UserCircle,
  LoaderCircle,
} from 'lucide-vue-next'
import { sendMessageStream } from '../api/deepseek'
import { shouldUseWebSearchTool, runWebSearchTool, buildWebSearchContext } from '../api/webSearchTool'
import CitationSources from '../components/CitationSources.vue'
import FollowUpSuggestions from '../components/FollowUpSuggestions.vue'
import MarkdownRenderer from '../components/MarkdownRenderer.vue'

const STORAGE_KEY = 'chat_bot_history_v3'
const LEGACY_STORAGE_KEYS = ['chat_bot_history_v2', 'chat_bot_sessions_v1']
const TURN_LOG_STORAGE_KEY = 'chat_bot_turn_logs_v2'
const LEGACY_TURN_LOG_STORAGE_KEYS = ['chat_bot_turn_logs_v1']
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
