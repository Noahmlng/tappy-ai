<template>
  <div class="mt-3">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Try next</div>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        v-for="item in items"
        :key="item.id"
        :disabled="disabled"
        :class="[
          'rounded-full border border-gray-300 bg-white px-3 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-100',
          disabled ? 'cursor-not-allowed opacity-60' : ''
        ]"
        @click="$emit('select', item)"
      >
        <span>{{ item.text }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['select'])
</script>
