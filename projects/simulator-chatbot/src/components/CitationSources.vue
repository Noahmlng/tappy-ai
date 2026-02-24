<template>
  <div class="mt-4 border-t border-[var(--border)] pt-4">
    <div class="text-[10px] font-medium uppercase tracking-widest text-[var(--pencil)]">Sources</div>

    <ul v-if="sources?.length" class="mt-2 space-y-1">
      <li v-for="(source, index) in sources" :key="source.id || index" class="text-xs">
        <a
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-[var(--indigo)] hover:underline"
          @click="$emit('source-click', source)"
        >
          [{{ index + 1 }}] {{ source.title }}
        </a>
        <div class="mt-0.5 text-[11px] text-[var(--pencil)]">{{ source.host }}</div>
      </li>
    </ul>

    <div v-else class="mt-2 text-[11px] text-[var(--pencil)]">No external sources used.</div>
  </div>
</template>

<script setup>
defineProps({
  sources: {
    type: Array,
    default: () => [],
  },
})

defineEmits(['source-click'])
</script>
