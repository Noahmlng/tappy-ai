<template>
  <div class="markdown-content" v-html="renderedHtml"></div>
</template>

<script setup>
import MarkdownIt from 'markdown-it'
import { computed } from 'vue'

const props = defineProps({
  content: {
    type: String,
    required: true,
  },
})

const markdownParser = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  typographer: true,
})

const defaultLinkOpen =
  markdownParser.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))

markdownParser.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const renderedHtml = computed(() => markdownParser.render(String(props.content || '')))
</script>

<style scoped>
.markdown-content {
  word-wrap: break-word;
  display: block;
}

.markdown-content :deep(h1) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
  display: block;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
  display: block;
}

.markdown-content :deep(h3) {
  font-size: 1.15em;
  font-weight: 500;
  margin: 0.75em 0 0.5em;
  display: block;
}

.markdown-content :deep(p) {
  margin: 0 0 1.1em;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(code) {
  background-color: var(--surface);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background-color: var(--surface);
  border-radius: 12px;
  padding: 1em;
  overflow-x: auto;
  margin: 0.75em 0;
  border: 1px solid var(--border);
  display: block;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.875em;
  line-height: 1.5;
  font-family: var(--font-mono);
  display: block;
}

.markdown-content :deep(a) {
  color: var(--indigo);
  text-decoration: underline;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
  display: block;
}

.markdown-content :deep(blockquote) {
  margin: 0.75em 0;
  border-left: 2px solid var(--indigo);
  padding-left: 0.75em;
  color: var(--graphite);
}

.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 0.9em 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--surface);
  font-weight: 600;
}
</style>
