<script setup>
defineProps({
  as: {
    type: String,
    default: 'article',
  },
})
</script>

<template>
  <component :is="as" class="card">
    <slot />
  </component>
</template>
