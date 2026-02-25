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
  margin-top: 16px;
  border-top: 1px solid #e5e5e5;
  padding-top: 12px;
}

.citation-sources > p {
  margin: 0;
  color: #8f8f8f;
  font-size: 10px;
  font-weight: 600;
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
  border: 1px solid #e4e4e4;
  border-radius: 10px;
  background: #fff;
  text-decoration: none;
  padding: 8px 10px;
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.citation-sources li a:hover {
  border-color: #d7d7d7;
  background: #f9f9f9;
}

.citation-sources li a:focus-visible {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
}

.source-index {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid #d7d7d7;
  color: #5d5d5d;
  font-size: 10px;
  font-weight: 600;
}

.source-title {
  color: #0d0d0d;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-host {
  grid-column: 2;
  color: #8f8f8f;
  font-size: 11px;
  letter-spacing: 0.01em;
}

.citation-empty {
  margin-top: 10px;
  color: #8f8f8f;
  font-size: 11px;
}
</style>
