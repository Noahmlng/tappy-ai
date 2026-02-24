<template>
  <div class="mt-4 rounded-xl border border-[var(--border)] bg-gradient-to-br from-white via-white to-[var(--surface)] p-3">
    <div class="mb-2 flex items-center justify-between">
      <span class="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--graphite)]">
        Sponsored
      </span>
      <span class="text-[11px] text-[var(--pencil)]">{{ ad.advertiser }}</span>
    </div>

    <a
      :href="ad.url"
      target="_blank"
      rel="noopener noreferrer"
      class="group block"
      @click="$emit('ad-click', ad)"
    >
      <div class="flex items-start gap-3">
        <img
          v-if="ad.imageUrl"
          :src="ad.imageUrl"
          :alt="ad.headline"
          class="h-16 w-16 shrink-0 rounded-lg border border-[var(--border)] bg-white object-cover"
          loading="lazy"
        />

        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-[var(--ink)]">{{ ad.headline }}</div>
          <p v-if="ad.description" class="mt-1 line-clamp-2 text-xs leading-snug text-[var(--graphite)]">
            {{ ad.description }}
          </p>

          <div class="mt-3 inline-flex items-center rounded-lg border border-[var(--indigo)] bg-[var(--indigo-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--indigo)] transition-opacity group-hover:opacity-80">
            {{ ad.ctaText }}
          </div>
        </div>
      </div>
    </a>
  </div>
</template>

<script setup>
defineProps({
  ad: {
    type: Object,
    required: true,
  },
})

defineEmits(['ad-click'])
</script>
