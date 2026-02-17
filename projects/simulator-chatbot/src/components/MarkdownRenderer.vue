<template>
  <span class="markdown-content" v-html="renderedHtml"></span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  content: {
    type: String,
    required: true,
  },
})

const renderedHtml = computed(() => renderMarkdown(props.content))

function renderMarkdown(text) {
  let html = text || ''

  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`
  })

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^(?:---|\*\*\*|___)$/gm, '<hr>')
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  html = html.replace(/\n/g, '<span class="line-break"></span>')

  return html
}
</script>

<style scoped>
.markdown-content {
  word-wrap: break-word;
  display: inline;
}

.markdown-content :deep(h1) {
  font-size: 1.5em;
  font-weight: 700;
  margin: 0.75em 0 0.5em;
  display: block;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
  font-weight: 700;
  margin: 0.75em 0 0.5em;
  display: block;
}

.markdown-content :deep(h3) {
  font-size: 1.15em;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
  display: block;
}

.markdown-content :deep(code) {
  background-color: #f0f0f0;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background-color: #f6f8fa;
  border-radius: 8px;
  padding: 1em;
  overflow-x: auto;
  margin: 0.75em 0;
  border: 1px solid #e5e7eb;
  display: block;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.875em;
  line-height: 1.5;
  display: block;
}

.markdown-content :deep(a) {
  color: #0066cc;
  text-decoration: underline;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
  display: block;
}

.markdown-content :deep(.line-break) {
  display: block;
  height: 10px;
}
</style>
