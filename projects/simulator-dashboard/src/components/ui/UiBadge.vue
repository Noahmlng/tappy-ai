<script setup>
defineProps({
  tone: {
    type: String,
    default: 'info',
  },
})
</script>

<template>
  <span class="ui-badge" :data-tone="tone">
    <slot />
  </span>
</template>
