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
  border: 1px solid #dbdbdb;
  background: #f1f1f1;
  color: var(--graphite);
  border-radius: var(--radius-pill);
  font-size: 12px;
  line-height: 1.25;
  text-align: left;
  padding: 7px 11px;
  cursor: pointer;
  box-shadow: none;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.followup-grid button:hover:not(:disabled) {
  transform: none;
  border-color: #d2d2d2;
  background: #ebebeb;
  color: #202123;
  box-shadow: none;
}

.followup-grid button:active:not(:disabled) {
  transform: none;
}

.followup-grid button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 56%, white);
  outline-offset: 2px;
  border-color: color-mix(in srgb, var(--accent-sea) 44%, transparent);
}

.followup-grid button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
