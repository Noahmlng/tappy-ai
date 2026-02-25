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
  margin-top: 14px;
}

.followup-wrap > p {
  margin: 0;
  color: #8f8f8f;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.followup-grid {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.followup-grid button {
  border: 1px solid #d8d8d8;
  background: #fff;
  color: #5d5d5d;
  border-radius: 999px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  text-align: left;
  min-height: 32px;
  padding: 7px 12px;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.followup-grid button:hover:not(:disabled) {
  border-color: #d0d0d0;
  background: #f3f3f3;
  color: #0d0d0d;
}

.followup-grid button:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.followup-grid button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
