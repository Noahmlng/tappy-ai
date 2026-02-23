<template>
  <div class="space-y-2">
    <div v-if="logs.length === 0" class="chat-trace-empty">
      No turn logs yet.
    </div>
    <div v-else class="chat-trace-list">
      <details
        v-for="log in logs"
        :key="log.turnId"
        class="chat-trace-item"
      >
        <summary class="list-none cursor-pointer">
          <div class="chat-trace-row">
            <span class="truncate font-medium text-[var(--chat-sidebar-ink)]">{{ log.userQuery }}</span>
            <span :class="['ml-auto chat-pill', log.toolUsed ? 'done' : 'neutral']">
              {{ log.toolUsed ? 'tool used' : 'no tool' }}
            </span>
          </div>
          <div class="chat-trace-meta">
            <span>{{ formatTraceTime(log.startedAt) }}</span>
            <span>·</span>
            <span>{{ formatDuration(log) }}</span>
          </div>
        </summary>

        <div class="chat-trace-events">
          <div class="chat-trace-retry">Retry count: {{ log.retryCount || 0 }}</div>
          <ul class="space-y-1">
            <li v-for="event in log.events" :key="event.id" class="chat-trace-event">
              <span class="text-[var(--chat-sidebar-muted)]">{{ formatTraceTime(event.at) }}</span>
              <span class="mx-1">·</span>
              <span class="chat-trace-dot"></span>
              <span class="mx-1">{{ formatTraceEventType(event.type) }}</span>
              <span :class="['chat-pill', eventTone(event.type)]">{{ eventToneLabel(event.type) }}</span>
            </li>
          </ul>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup>
defineProps({
  logs: {
    type: Array,
    default: () => [],
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

function formatDuration(log) {
  const start = Number(log?.startedAt || 0)
  const end = Number(log?.endedAt || 0)
  if (!start) return '-'
  if (!end || end < start) return 'in progress'
  const ms = Math.max(0, Math.floor(end - start))
  return `${ms}ms`
}

function eventTone(eventType) {
  const normalized = String(eventType || '').toLowerCase()
  if (!normalized) return 'neutral'
  if (normalized.includes('fail') || normalized.includes('error')) return 'error'
  if (normalized.includes('start') || normalized.includes('running')) return 'running'
  if (normalized.includes('complete') || normalized.includes('done') || normalized.includes('rendered')) return 'done'
  return 'neutral'
}

function eventToneLabel(eventType) {
  const tone = eventTone(eventType)
  if (tone === 'error') return 'error'
  if (tone === 'running') return 'running'
  if (tone === 'done') return 'done'
  return 'info'
}
</script>
