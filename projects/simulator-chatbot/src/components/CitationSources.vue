<template>
  <div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Sources</div>

    <ul v-if="sources?.length" class="mt-2 space-y-1">
      <li v-for="(source, index) in sources" :key="source.id || index" class="text-xs">
        <a
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-blue-700 hover:underline"
          @click="$emit('source-click', source)"
        >
          [{{ index + 1 }}] {{ source.title }}
        </a>
        <div class="mt-0.5 text-[11px] text-gray-500">{{ source.host }}</div>
      </li>
    </ul>

    <div v-else class="mt-2 text-[11px] text-gray-500">No external sources used.</div>
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
