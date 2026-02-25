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
  color: var(--ink);
  font-size: 15px;
  line-height: 1.78;
}

.markdown-content :deep(h1) {
  font-family: var(--font-display);
  font-size: 1.72em;
  font-weight: 650;
  margin: 0.7em 0 0.45em;
  line-height: 1.15;
  display: block;
}

.markdown-content :deep(h2) {
  font-family: var(--font-display);
  font-size: 1.46em;
  font-weight: 620;
  margin: 0.72em 0 0.44em;
  line-height: 1.2;
  display: block;
}

.markdown-content :deep(h3) {
  font-size: 1.14em;
  font-weight: 680;
  margin: 0.7em 0 0.4em;
  display: block;
}

.markdown-content :deep(p) {
  margin: 0 0 1em;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(code) {
  background-color: color-mix(in srgb, var(--surface) 70%, white);
  border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  padding: 0.14em 0.44em;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.86em;
  color: color-mix(in srgb, var(--ink) 85%, var(--accent-sea));
}

.markdown-content :deep(pre) {
  background-color: color-mix(in srgb, var(--surface) 82%, white);
  border-radius: 14px;
  padding: 0.95em 1em;
  overflow-x: auto;
  margin: 0.75em 0;
  border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  display: block;
}

.markdown-content :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
  font-size: 0.875em;
  line-height: 1.65;
  font-family: var(--font-mono);
  display: block;
  color: color-mix(in srgb, var(--ink) 90%, #24342d);
}

.markdown-content :deep(a) {
  color: color-mix(in srgb, var(--accent-sea) 90%, #0b1712);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1.2px;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.6em 0;
  display: block;
}

.markdown-content :deep(blockquote) {
  margin: 0.8em 0;
  border-left: 3px solid color-mix(in srgb, var(--accent-sea) 72%, white);
  background: color-mix(in srgb, var(--indigo-soft) 42%, white);
  border-radius: 0 10px 10px 0;
  padding: 0.45em 0.9em;
  color: color-mix(in srgb, var(--graphite) 95%, #23352d);
}

.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
  margin: 0.9em 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
  padding: 7px 9px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: color-mix(in srgb, var(--surface) 75%, white);
  font-weight: 700;
}
</style>
