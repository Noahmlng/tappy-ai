<template>
  <div class="followup-wrap">
    <p>Try Next</p>
    <div class="followup-grid">
      <button v-for="item in items" :key="item.id" :disabled="disabled" @click="$emit('select', item)">
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

<style scoped>
.followup-wrap {
  margin-top: 12px;
}

.followup-wrap > p {
  margin: 0;
  color: var(--pencil);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.followup-grid {
  margin-top: 9px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.followup-grid button {
  border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
  background: color-mix(in srgb, white 86%, var(--paper));
  color: var(--graphite);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.25;
  text-align: left;
  padding: 7px 11px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.followup-grid button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-sea) 44%, transparent);
  background: color-mix(in srgb, var(--indigo-soft) 70%, white);
  color: color-mix(in srgb, var(--accent-sea) 90%, black);
}

.followup-grid button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
