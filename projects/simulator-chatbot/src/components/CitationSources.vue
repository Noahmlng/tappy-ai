<template>
  <div class="mt-3 rounded-2xl border border-[#e5e7eb] bg-[#f8f9fa] px-3 py-2">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-[#8f8f95]">Sources</div>

    <ul v-if="sources?.length" class="mt-2 space-y-1">
      <li v-for="(source, index) in sources" :key="source.id || index" class="text-xs">
        <a
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-[#2f5bd3] hover:underline"
          @click="$emit('source-click', source)"
        >
          [{{ index + 1 }}] {{ source.title }}
        </a>
        <div class="mt-0.5 text-[11px] text-[#9ca3af]">{{ source.host }}</div>
      </li>
    </ul>

    <div v-else class="mt-2 text-[11px] text-[#8f8f95]">No external sources used.</div>
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
