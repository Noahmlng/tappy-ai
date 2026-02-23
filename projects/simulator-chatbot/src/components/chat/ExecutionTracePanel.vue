<template>
  <div class="space-y-2">
    <div v-if="logs.length === 0" class="rounded-lg border border-[#30353e] bg-[#181b21] px-2 py-2 text-[11px] text-[var(--chat-sidebar-muted)]">
      No turn logs yet.
    </div>
    <div v-else class="max-h-60 space-y-1 overflow-y-auto pr-1">
      <details
        v-for="log in logs"
        :key="log.turnId"
        class="rounded border border-[#30353e] bg-[#181b21] px-2 py-1"
      >
        <summary class="list-none cursor-pointer">
          <div class="flex items-center gap-1 text-[11px]">
            <span class="truncate font-medium text-[var(--chat-sidebar-ink)]">{{ log.userQuery }}</span>
            <span :class="['ml-auto chat-pill', log.toolUsed ? 'done' : 'neutral']">
              {{ log.toolUsed ? 'tool used' : 'no tool' }}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2 text-[10px] text-[var(--chat-sidebar-muted)]">
            <span>{{ formatTraceTime(log.startedAt) }}</span>
            <span>·</span>
            <span>{{ formatDuration(log) }}</span>
          </div>
        </summary>

        <div class="mt-2 border-t border-[#333842] pt-2 text-[11px] text-[var(--chat-sidebar-ink)]">
          <div class="mb-1 text-[10px] text-[var(--chat-sidebar-muted)]">Retry count: {{ log.retryCount || 0 }}</div>
          <ul class="space-y-1">
            <li v-for="event in log.events" :key="event.id" class="leading-tight">
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
