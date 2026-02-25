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
  margin-top: 16px;
  border-radius: 12px;
  border: 1px solid #dddddd;
  background: #f3f3f3;
  padding: 12px;
  transition:
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard);
}

.ad-card:hover {
  border-color: #d4d4d4;
  background: #efefef;
}

.ad-card:focus-within {
  border-color: #cfcfcf;
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
  border: 1px solid #d4d4d4;
  background: #ededed;
  color: #5d5d5d;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 4px 8px;
}

.ad-card-meta span:last-child {
  color: #8f8f8f;
  font-size: 11px;
}

.ad-card-link {
  display: flex;
  gap: 12px;
  text-decoration: none;
  color: inherit;
  border-radius: 10px;
}

.ad-card-link:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.ad-card-link img {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid #d6d6d6;
  background: #fff;
}

.ad-card-copy {
  min-width: 0;
  flex: 1;
}

.ad-card-copy h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  color: #0d0d0d;
}

.ad-card-copy p {
  margin: 6px 0 0;
  color: #5d5d5d;
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
  min-height: 32px;
  border-radius: 999px;
  border: 1px solid #000;
  background: #000;
  color: #fff;
  padding: 7px 12px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.ad-card-link:hover .ad-card-cta {
  border-color: #1f1f1f;
  background: #1f1f1f;
}

@media (max-width: 560px) {
  .ad-card-link img {
    width: 60px;
    height: 60px;
  }
}
</style>
