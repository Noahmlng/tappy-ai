<template>
  <div class="mt-3">
    <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b7d99]">Try next</div>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        v-for="item in items"
        :key="item.id"
        :disabled="disabled"
        :class="[
          'rounded-full border border-[#d1dced] bg-[#f9fbff] px-3 py-1.5 text-left text-xs text-[#465b7a] transition-colors hover:bg-[#eef4ff]',
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
