<script setup>
import { Input } from './input'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: '',
  },
  type: {
    type: String,
    default: 'text',
  },
  min: {
    type: [String, Number],
    default: undefined,
  },
  max: {
    type: [String, Number],
    default: undefined,
  },
  step: {
    type: [String, Number],
    default: undefined,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  placeholder: {
    type: String,
    default: '',
  },
  class: {
    type: [String, Array, Object],
    default: '',
  },
})

const emit = defineEmits(['update:modelValue'])

function handleInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <Input
    class="h-10 rounded-[8px] border-[var(--dash-stroke)] px-[11px] text-[15px] text-[#1a2028] shadow-none focus-visible:ring-2 focus-visible:ring-[rgb(29_94_255/0.08)] focus-visible:border-[#b8c9e9]"
    :class="props.class"
    :type="type"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :placeholder="placeholder"
    @input="handleInput"
  />
</template>
