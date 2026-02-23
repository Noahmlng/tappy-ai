<script setup>
import { computed } from 'vue'

import { Card } from './card'

const props = defineProps({
  class: {
    type: [String, Array, Object],
    default: '',
  },
})

const cardClass = computed(() => ([
  'rounded-[12px] border-[var(--dash-stroke)] bg-[var(--dash-surface)] shadow-none',
  'px-[18px] py-[18px] gap-[14px]',
  props.class,
]))
</script>

<template>
  <Card :class="cardClass">
    <slot />
  </Card>
</template>
