<template>
  <div class="mt-3 rounded-xl border border-[#cbe5d7] bg-[#ebf8f1] p-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2f7d51]">Related Products · Sponsored</span>
        <span class="text-[10px] text-[#4d8f69]">{{ placementLabel }}</span>
      </div>
      <button
        type="button"
        class="rounded-md border border-[#9fd0b5] bg-white px-2 py-0.5 text-[10px] text-[#2f7d51] transition-colors hover:bg-[#e7f5ed]"
        @click="$emit('dismiss')"
      >
        Dismiss
      </button>
    </div>

    <ul class="space-y-2">
      <li
        v-for="ad in visibleItems"
        :key="ad.itemId"
        class="rounded-lg border border-[#cbe5d7] bg-white p-2"
      >
        <a
          :href="resolveHref(ad)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm font-medium text-[#2463d6] hover:underline"
          @click="$emit('click-item', ad)"
        >
          {{ ad.title }}
        </a>
        <p v-if="ad.snippet" class="mt-1 text-xs text-[#4b5563]">{{ ad.snippet }}</p>
        <p v-if="ad.matchReasons?.length" class="mt-1 text-[11px] text-[#6b7280]">
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

const placementLabel = computed(() => {
  const placementId = typeof props.slotData?.placementId === 'string' ? props.slotData.placementId.trim() : ''
  return placementId || 'chat_followup_v1'
})

function resolveHref(ad) {
  if (!ad || typeof ad !== 'object') return ''
  if (typeof ad.clickUrl === 'string' && ad.clickUrl.trim()) return ad.clickUrl.trim()
  if (typeof ad.targetUrl === 'string' && ad.targetUrl.trim()) return ad.targetUrl.trim()
  return ''
}
</script>
