<template>
  <div class="mt-3 rounded-r-xl border-l-2 border-[var(--indigo)] bg-[var(--indigo-soft)] py-3 pl-3 pr-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-medium uppercase tracking-widest text-[var(--graphite)]">Related Products</span>
        <span class="text-[10px] text-[var(--pencil)]">Sponsored</span>
      </div>
      <button
        type="button"
        class="rounded-md px-2 py-0.5 text-[10px] text-[var(--pencil)] transition-colors hover:text-[var(--ink)]"
        @click="$emit('dismiss')"
      >
        Dismiss
      </button>
    </div>

    <ul>
      <li
        v-for="(ad, idx) in visibleItems"
        :key="ad.itemId"
        :class="['py-2', idx < visibleItems.length - 1 ? 'border-b border-[var(--border)]' : '']"
      >
        <a
          :href="resolveHref(ad)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm font-medium text-[var(--indigo)] hover:underline"
          @click="$emit('click-item', ad)"
        >
          {{ ad.title }}
        </a>
        <p v-if="ad.snippet" class="mt-1 text-xs text-[var(--graphite)]">{{ ad.snippet }}</p>
        <p v-if="ad.matchReasons?.length" class="mt-1 text-[11px] text-[var(--pencil)]">
          {{ ad.matchReasons.join(' · ') }}
        </p>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  slotData: {
    type: Object,
    default: null,
  },
  maxItems: {
    type: Number,
    default: 3,
  },
})

defineEmits(['click-item', 'dismiss'])

const visibleItems = computed(() => {
  const ads = Array.isArray(props.slotData?.ads) ? props.slotData.ads : []
  const limit = Number.isFinite(props.maxItems) && props.maxItems > 0 ? Math.floor(props.maxItems) : 3
  return ads.slice(0, Math.min(3, limit))
})

function resolveHref(ad) {
  if (!ad || typeof ad !== 'object') return ''
  if (typeof ad.clickUrl === 'string' && ad.clickUrl.trim()) return ad.clickUrl.trim()
  if (typeof ad.targetUrl === 'string' && ad.targetUrl.trim()) return ad.targetUrl.trim()
  return ''
}
</script>
