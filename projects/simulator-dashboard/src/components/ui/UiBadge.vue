<script setup>
import { computed } from 'vue'

import { Badge } from './badge'

const props = defineProps({
  tone: {
    type: String,
    default: 'info',
  },
  class: {
    type: [String, Array, Object],
    default: '',
  },
})

const variantMap = {
  success: 'outline',
  warn: 'secondary',
  error: 'destructive',
  info: 'secondary',
}

const toneClassMap = {
  success: 'border-[var(--dash-success-stroke)] bg-[var(--dash-success-bg)] text-[var(--dash-success-ink)]',
  warn: 'border-[var(--dash-warn-stroke)] bg-[var(--dash-warn-bg)] text-[var(--dash-warn-ink)]',
  error: 'border-[var(--dash-error-stroke)] bg-[var(--dash-error-bg)] text-[var(--dash-error-ink)]',
  info: 'border-[var(--dash-info-stroke)] bg-[var(--dash-info-bg)] text-[var(--dash-info-ink)]',
}

const mappedVariant = computed(() => variantMap[props.tone] || 'secondary')
const toneClass = computed(() => toneClassMap[props.tone] || toneClassMap.info)
</script>

<template>
  <Badge
    :variant="mappedVariant"
    class="text-[12px] font-semibold uppercase tracking-[0.06em] rounded-full px-[9px] py-[3px]"
    :class="[toneClass, props.class]"
  >
    <slot />
  </Badge>
</template>
