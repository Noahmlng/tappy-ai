<script setup>
import { computed } from 'vue'

import { Button } from './button'

const props = defineProps({
  variant: {
    type: String,
    default: 'primary',
  },
  size: {
    type: String,
    default: 'default',
  },
  as: {
    type: String,
    default: 'button',
  },
  asChild: {
    type: Boolean,
    default: false,
  },
  class: {
    type: [String, Array, Object],
    default: '',
  },
  type: {
    type: String,
    default: 'button',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const variantMap = {
  primary: 'default',
  secondary: 'outline',
  danger: 'destructive',
}

const mappedVariant = computed(() => variantMap[props.variant] || props.variant || 'default')

const normalizedSize = computed(() => {
  if (!props.size) return 'default'
  if (props.size === 'small') return 'sm'
  if (props.size === 'large') return 'lg'
  return props.size
})

const legacyClassMap = {
  primary: 'bg-[var(--dash-primary)] text-white hover:bg-[#1a2230]',
  secondary: 'border-[var(--dash-stroke)] bg-[var(--dash-surface)] text-[#2b3341] hover:bg-[var(--dash-surface-soft)]',
  danger: 'border-[var(--dash-error-stroke)] bg-[var(--dash-error-bg)] text-[var(--dash-error-ink)] hover:bg-[#ffe4e2]',
}

const legacyClass = computed(() => legacyClassMap[props.variant] || '')
</script>

<template>
  <Button
    :variant="mappedVariant"
    :size="normalizedSize"
    :as="as"
    :as-child="asChild"
    :type="as === 'button' ? type : undefined"
    :disabled="disabled"
    :class="[legacyClass, props.class]"
    v-bind="$attrs"
  >
    <slot />
  </Button>
</template>
