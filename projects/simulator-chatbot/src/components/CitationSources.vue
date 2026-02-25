<template>
  <div class="citation-sources">
    <p>Sources</p>

    <ul v-if="sources?.length">
      <li v-for="(source, index) in sources" :key="source.id || index">
        <a :href="source.url" target="_blank" rel="noopener noreferrer" @click="$emit('source-click', source)">
          <span class="source-index">{{ index + 1 }}</span>
          <span class="source-title">{{ source.title }}</span>
          <span class="source-host">{{ source.host }}</span>
        </a>
      </li>
    </ul>

    <div v-else class="citation-empty">No external sources used.</div>
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

<style scoped>
.citation-sources {
  margin-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--ink) 11%, transparent);
  padding-top: 12px;
}

.citation-sources > p {
  margin: 0;
  color: var(--pencil);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.citation-sources ul {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.citation-sources li a {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--ink) 11%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, white 84%, var(--paper));
  text-decoration: none;
  padding: 8px 10px;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.citation-sources li a:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-sea) 38%, transparent);
}

.citation-sources li a:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-sea) 56%, white);
  outline-offset: 2px;
  border-color: color-mix(in srgb, var(--accent-sea) 44%, transparent);
}

.source-index {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
  color: var(--graphite);
  font-size: 10px;
  font-weight: 700;
}

.source-title {
  color: color-mix(in srgb, var(--accent-sea) 90%, #00150f);
  font-size: 12px;
  font-weight: 620;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-host {
  grid-column: 2;
  color: var(--pencil);
  font-size: 11px;
}

.citation-empty {
  margin-top: 10px;
  color: var(--pencil);
  font-size: 11px;
}
</style>
