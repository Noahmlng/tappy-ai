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
  color: #0d0d0d;
  font-size: 16px;
  line-height: 24px;
}

.markdown-content :deep(h1) {
  font-family: var(--font-display);
  font-size: 1.55em;
  font-weight: 600;
  margin: 0.72em 0 0.44em;
  line-height: 1.22;
  display: block;
}

.markdown-content :deep(h2) {
  font-family: var(--font-display);
  font-size: 1.3em;
  font-weight: 600;
  margin: 0.7em 0 0.42em;
  line-height: 1.24;
  display: block;
}

.markdown-content :deep(h3) {
  font-size: 1.12em;
  font-weight: 600;
  margin: 0.66em 0 0.38em;
  display: block;
}

.markdown-content :deep(p) {
  margin: 0 0 0.94em;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(code) {
  background: #f3f3f3;
  border: 1px solid #dfdfdf;
  padding: 0.14em 0.42em;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.86em;
  color: #0d0d0d;
}

.markdown-content :deep(pre) {
  background: #f3f3f3;
  border-radius: 10px;
  padding: 0.95em 1em;
  overflow-x: auto;
  margin: 0.75em 0;
  border: 1px solid #dfdfdf;
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
  color: #0d0d0d;
}

.markdown-content :deep(a) {
  color: #0d0d0d;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  transition:
    color var(--motion-fast) var(--ease-standard),
    text-decoration-color var(--motion-fast) var(--ease-standard);
}

.markdown-content :deep(a:hover) {
  color: #3a3a3a;
}

.markdown-content :deep(a:focus-visible) {
  outline: 1.5px solid #0d0d0d;
  outline-offset: 2px;
  border-radius: 4px;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.6em 0;
  display: block;
}

.markdown-content :deep(blockquote) {
  margin: 0.8em 0;
  border-left: 3px solid #d6d6d6;
  background: #f3f3f3;
  border-radius: 0 10px 10px 0;
  padding: 0.52em 0.9em;
  color: #5d5d5d;
}

.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid #dfdfdf;
  margin: 0.9em 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #dfdfdf;
  padding: 7px 9px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: #f3f3f3;
  font-weight: 600;
}
</style>
