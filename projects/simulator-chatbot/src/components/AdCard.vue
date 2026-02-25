<template>
  <div class="ad-card">
    <div class="ad-card-meta">
      <span>Sponsored</span>
      <span>{{ ad.advertiser }}</span>
    </div>

    <a :href="ad.url" target="_blank" rel="noopener noreferrer" class="ad-card-link" @click="$emit('ad-click', ad)">
      <img v-if="ad.imageUrl" :src="ad.imageUrl" :alt="ad.headline" loading="lazy" />

      <div class="ad-card-copy">
        <h4>{{ ad.headline }}</h4>
        <p v-if="ad.description">{{ ad.description }}</p>
        <div class="ad-card-cta">{{ ad.ctaText }}</div>
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

<style scoped>
.ad-card {
  margin-top: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--paper) 55%, white), color-mix(in srgb, var(--surface) 74%, white));
  box-shadow: var(--soft-shadow);
  padding: 12px;
}

.ad-card-meta {
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.ad-card-meta span:first-child {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
  background: color-mix(in srgb, var(--surface) 75%, white);
  color: var(--graphite);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 4px 8px;
}

.ad-card-meta span:last-child {
  color: var(--pencil);
  font-size: 11px;
}

.ad-card-link {
  display: flex;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}

.ad-card-link img {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  background: #fff;
}

.ad-card-copy {
  min-width: 0;
  flex: 1;
}

.ad-card-copy h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ink);
}

.ad-card-copy p {
  margin: 6px 0 0;
  color: var(--graphite);
  font-size: 12px;
  line-height: 1.42;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ad-card-cta {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent-sea) 48%, transparent);
  background: color-mix(in srgb, var(--accent-sea) 12%, white);
  color: color-mix(in srgb, var(--accent-sea) 88%, black);
  padding: 6px 11px;
  font-size: 11px;
  font-weight: 650;
  transition: transform 0.16s ease, background-color 0.16s ease;
}

.ad-card-link:hover .ad-card-cta {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent-sea) 18%, white);
}

@media (max-width: 560px) {
  .ad-card-link img {
    width: 60px;
    height: 60px;
  }
}
</style>
