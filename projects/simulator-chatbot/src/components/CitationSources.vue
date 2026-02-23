<template>
  <div class="mt-3 rounded-2xl border border-[#d2dced] bg-[#f5f9ff] px-3 py-2">
    <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#647594]">Sources</div>

    <ul v-if="sources?.length" class="mt-2 space-y-1">
      <li v-for="(source, index) in sources" :key="source.id || index" class="text-xs">
        <a
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-[#2c58bc] hover:underline"
          @click="$emit('source-click', source)"
        >
          [{{ index + 1 }}] {{ source.title }}
        </a>
        <div class="mt-0.5 text-[11px] text-[#7f8fa8]">{{ source.host }}</div>
      </li>
    </ul>

    <div v-else class="mt-2 text-[11px] text-[#7f8fa8]">No external sources used.</div>
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
