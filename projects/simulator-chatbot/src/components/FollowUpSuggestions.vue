<template>
  <div class="mt-3">
    <div class="text-[10px] font-medium uppercase tracking-widest text-[var(--pencil)]">Try next</div>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        v-for="item in items"
        :key="item.id"
        :disabled="disabled"
        :class="[
          'rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-left text-xs text-[var(--graphite)] transition-colors hover:border-[var(--indigo)] hover:bg-[var(--indigo-soft)] hover:text-[var(--indigo)]',
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
