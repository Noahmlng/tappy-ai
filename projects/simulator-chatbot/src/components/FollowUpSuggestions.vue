<template>
  <div class="mt-3">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Try next</div>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        v-for="item in items"
        :key="item.id"
        :disabled="disabled"
        :class="[
          'rounded-full border px-3 py-1.5 text-left text-xs transition-colors',
          item.isSponsored
            ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100',
          disabled ? 'cursor-not-allowed opacity-60' : ''
        ]"
        @click="$emit('select', item)"
      >
        <span v-if="item.isSponsored" class="mr-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
          {{ item.label || 'Sponsored' }}
        </span>
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
