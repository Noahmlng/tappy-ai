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
        >
          [{{ index + 1 }}] {{ source.title }}
        </a>
        <div class="mt-0.5 text-[11px] text-gray-500">{{ source.host }}</div>
      </li>
    </ul>

    <div v-else class="mt-2 text-[11px] text-gray-500">No external sources used.</div>

    <div
      v-if="sponsoredSource?.url"
      class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs"
    >
      <div class="mb-1 inline-flex items-center rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
        {{ sponsoredSource.label || 'Sponsored' }}
      </div>
      <a
        :href="sponsoredSource.url"
        target="_blank"
        rel="noopener noreferrer"
        class="block font-medium text-amber-900 hover:underline"
      >
        {{ sponsoredSource.title }}
      </a>
      <div v-if="sponsoredSource.advertiser" class="mt-0.5 text-[11px] text-amber-700">
        {{ sponsoredSource.advertiser }}
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  sources: {
    type: Array,
    default: () => [],
  },
  sponsoredSource: {
    type: Object,
    default: null,
  },
})
</script>
