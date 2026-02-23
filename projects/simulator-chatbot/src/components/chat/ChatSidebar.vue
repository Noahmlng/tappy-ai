<template>
  <aside
    :class="[
      'chat-sidebar chat-sidebar-shell fixed z-40 flex h-full w-[294px] -translate-x-full flex-col transition-transform duration-300 ease-in-out lg:relative lg:z-0 lg:translate-x-0',
      isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
    ]"
  >
    <div class="chat-sidebar-head">
      <div class="mb-2 flex items-center justify-between lg:hidden">
        <button @click="$emit('close-sidebar')" class="chat-sidebar-close">
          <X :size="18" />
        </button>
      </div>

      <div class="chat-sidebar-brand">
        <p class="chat-sidebar-eyebrow">Simulator Console</p>
        <p class="chat-sidebar-title">Codex Mode</p>
        <p class="chat-sidebar-subtitle">Conversation-first workspace</p>
      </div>

      <button
        @click="$emit('start-new-chat')"
        class="chat-sidebar-newchat group flex items-center justify-between"
      >
        <div class="flex items-center gap-2">
          <div class="rounded-full border border-[#5f86c7] bg-[#0f1830] p-1">
            <Plus :size="14" />
          </div>
          <span>New Chat</span>
        </div>
        <MessageSquare :size="14" class="text-[#a5badc] opacity-0 group-hover:opacity-100" />
      </button>

      <label class="chat-sidebar-search">
        <Search :size="16" class="text-[var(--chat-sidebar-muted)]" />
        <input
          :value="historyQuery"
          type="text"
          placeholder="Search history"
          class="text-sm"
          @input="$emit('update:historyQuery', $event.target.value)"
        >
      </label>
    </div>

    <div class="chat-session-list scrollbar-thin flex-1 space-y-1 overflow-y-auto">
      <div class="chat-session-list-title">Recent Runs</div>

      <div
        v-for="session in filteredSessions"
        :key="session.id"
        :class="[
          'chat-session-item group w-full text-sm outline-none',
          session.id === activeSessionId ? 'active' : ''
        ]"
      >
        <button class="chat-session-main" @click="$emit('open-session', session.id)">
          <div class="chat-session-title">{{ session.title }}</div>
          <div class="chat-session-time">{{ formatSessionTime(session.updatedAt) }}</div>
        </button>
        <button
          class="chat-delete-btn"
          aria-label="Delete chat"
          title="Delete chat"
          @click.stop="$emit('delete-session', session.id)"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <div v-if="filteredSessions.length === 0" class="chat-empty-history">
        No chat history.
      </div>
    </div>

    <div class="chat-sidebar-footer">
      <details class="chat-panel" open>
        <summary class="chat-panel-summary">
          System Prompt
        </summary>
        <div class="chat-panel-actions">
          <button
            class="chat-panel-reset disabled:opacity-60"
            :disabled="!activeSession"
            @click="$emit('reset-system-prompt')"
          >
            Reset
          </button>
        </div>
        <textarea
          :value="activeSystemPrompt"
          :disabled="!activeSession"
          rows="4"
          class="chat-system-input disabled:opacity-60"
          placeholder="Set a per-chat system prompt..."
          @input="$emit('update:activeSystemPrompt', $event.target.value)"
        ></textarea>
        <div class="chat-panel-note">
          Applied to every request in the current chat. New Chat resets to default.
        </div>
      </details>

      <details v-if="isDebugMode" class="chat-panel" :open="tracePanelOpen">
        <summary
          class="chat-panel-summary"
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
        class="chat-clear-btn"
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
  isDebugMode: {
    type: Boolean,
    default: false,
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
