<template>
  <aside
    :class="[
      'chat-sidebar fixed z-40 flex h-full w-[286px] -translate-x-full flex-col transition-transform duration-300 ease-in-out lg:relative lg:z-0 lg:translate-x-0',
      isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
    ]"
  >
    <div class="border-b border-[var(--chat-sidebar-stroke)] p-3">
      <div class="mb-2 flex items-center justify-between lg:hidden">
        <button @click="$emit('close-sidebar')" class="rounded-lg p-2 text-[var(--chat-sidebar-muted)] hover:bg-[#262b33]">
          <X :size="18" />
        </button>
      </div>

      <button
        @click="$emit('start-new-chat')"
        class="group flex w-full items-center justify-between rounded-xl border border-[var(--chat-sidebar-stroke)] bg-[var(--chat-sidebar-surface)] p-2 text-sm font-medium transition-colors hover:bg-[#212732]"
      >
        <div class="flex items-center gap-2">
          <div class="rounded-full border border-[#3a3f4a] bg-[#13161c] p-1">
            <Plus :size="14" />
          </div>
          <span>New Chat</span>
        </div>
        <MessageSquare :size="14" class="text-[var(--chat-sidebar-muted)] opacity-0 group-hover:opacity-100" />
      </button>

      <label class="mt-2 flex items-center gap-2 rounded-xl border border-[var(--chat-sidebar-stroke)] bg-[var(--chat-sidebar-surface)] px-2 py-2 text-sm">
        <Search :size="16" class="text-[var(--chat-sidebar-muted)]" />
        <input
          :value="historyQuery"
          type="text"
          placeholder="Search history"
          class="w-full bg-transparent text-[var(--chat-sidebar-ink)] outline-none placeholder:text-[var(--chat-sidebar-muted)]"
          @input="$emit('update:historyQuery', $event.target.value)"
        >
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
            ? 'bg-[#2a303a] text-white'
            : 'text-[var(--chat-sidebar-ink)] hover:bg-[#202631]'
        ]"
      >
        <button class="w-full pr-9 text-left" @click="$emit('open-session', session.id)">
          <div class="truncate">{{ session.title }}</div>
          <div class="mt-1 text-[11px] text-[var(--chat-sidebar-muted)]">{{ formatSessionTime(session.updatedAt) }}</div>
        </button>
        <button
          class="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-1 text-[var(--chat-sidebar-muted)] hover:bg-[#353b46] group-hover:flex"
          aria-label="Delete chat"
          title="Delete chat"
          @click.stop="$emit('delete-session', session.id)"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <div v-if="filteredSessions.length === 0" class="px-2 py-5 text-xs text-[var(--chat-sidebar-muted)]">
        No chat history.
      </div>
    </div>

    <div class="space-y-2 border-t border-[var(--chat-sidebar-stroke)] p-3">
      <details class="rounded-xl border border-[var(--chat-sidebar-stroke)] bg-[var(--chat-sidebar-surface)] p-2" open>
        <summary class="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-sidebar-muted)]">
          System Prompt
        </summary>
        <div class="mt-2 flex items-center justify-end">
          <button
            class="rounded border border-[#3a3f4a] px-1.5 py-0.5 text-[10px] text-[var(--chat-sidebar-muted)] hover:bg-[#262c36] disabled:opacity-60"
            :disabled="!activeSession"
            @click="$emit('reset-system-prompt')"
          >
            Reset
          </button>
        </div>
        <textarea
          :value="activeSystemPrompt"
          :disabled="!activeSession"
          rows="5"
          class="mt-2 w-full resize-y rounded-lg border border-[#3a3f4a] bg-[#141922] px-2 py-1.5 text-[12px] text-[var(--chat-sidebar-ink)] outline-none focus:border-[#566170] disabled:opacity-60"
          placeholder="Set a per-chat system prompt..."
          @input="$emit('update:activeSystemPrompt', $event.target.value)"
        ></textarea>
        <div class="mt-1 text-[10px] text-[var(--chat-sidebar-muted)]">
          Applied to every request in the current chat. New Chat resets to default.
        </div>
      </details>

      <details class="rounded-xl border border-[var(--chat-sidebar-stroke)] bg-[var(--chat-sidebar-surface)] p-2" :open="tracePanelOpen">
        <summary
          class="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-sidebar-muted)]"
          @click.prevent="$emit('update:tracePanelOpen', !tracePanelOpen)"
        >
          Turn Trace
        </summary>
        <ExecutionTracePanel
          v-show="tracePanelOpen"
          class="mt-2"
          :logs="activeSessionTurnLogs"
          :format-trace-time="formatTraceTime"
          :format-trace-event-type="formatTraceEventType"
        />
      </details>

      <button
        class="w-full rounded-xl border border-[var(--chat-sidebar-stroke)] bg-[var(--chat-sidebar-surface)] px-3 py-2 text-xs font-medium text-[var(--chat-sidebar-ink)] hover:bg-[#212732]"
        @click="$emit('clear-history')"
      >
        Clear History
      </button>
    </div>
  </aside>
</template>

<script setup>
import { MessageSquare, Plus, Search, Trash2, X } from 'lucide-vue-next'

import ExecutionTracePanel from './ExecutionTracePanel.vue'

defineProps({
  isSidebarOpen: {
    type: Boolean,
    default: true,
  },
  historyQuery: {
    type: String,
    default: '',
  },
  filteredSessions: {
    type: Array,
    default: () => [],
  },
  activeSessionId: {
    type: String,
    default: '',
  },
  activeSession: {
    type: Object,
    default: null,
  },
  activeSystemPrompt: {
    type: String,
    default: '',
  },
  activeSessionTurnLogs: {
    type: Array,
    default: () => [],
  },
  tracePanelOpen: {
    type: Boolean,
    default: true,
  },
  formatSessionTime: {
    type: Function,
    required: true,
  },
  formatTraceTime: {
    type: Function,
    required: true,
  },
  formatTraceEventType: {
    type: Function,
    required: true,
  },
})

defineEmits([
  'close-sidebar',
  'start-new-chat',
  'open-session',
  'delete-session',
  'update:historyQuery',
  'reset-system-prompt',
  'update:activeSystemPrompt',
  'clear-history',
  'update:tracePanelOpen',
])
</script>
