<template>
  <span
    ref="wrapperRef"
    class="markdown-content-wrapper"
    @mouseover="handleWrapperMouseOver"
    @mouseout="handleWrapperMouseOut"
    @click="handleWrapperClick"
  >
    <span class="markdown-content" v-html="renderedHtml"></span>
    <span
      v-if="activeOffer"
      ref="popoverRef"
      class="inline-offer-popover"
      :style="{
        left: `${popoverPosition.left}px`,
        top: `${popoverPosition.top}px`,
      }"
      @mouseenter="handlePopoverMouseEnter"
      @mouseleave="handlePopoverMouseLeave"
    >
      <span class="inline-offer-popover-title">{{ activeOffer.title || activeOffer.entityText || 'Sponsored link' }}</span>
      <a
        :href="activeOffer.targetUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-offer-popover-link"
        @click.stop="handlePopoverLinkClick"
      >
        Open Link
      </a>
    </span>
  </span>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  inlineOffers: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['ad-click'])

const wrapperRef = ref(null)
const popoverRef = ref(null)
const activeOfferId = ref('')
const pinnedOfferId = ref('')
const isPopoverHovered = ref(false)
const popoverPosition = ref({ left: 0, top: 0 })

const inlineOfferEntries = computed(() => {
  const seen = new Set()
  const entries = []

  for (const raw of Array.isArray(props.inlineOffers) ? props.inlineOffers : []) {
    const offer = raw && typeof raw === 'object' ? raw : null
    if (!offer) continue

    const targetUrl = typeof offer.targetUrl === 'string' ? offer.targetUrl.trim() : ''
    if (!targetUrl) continue

    const label = resolveInlineOfferLabel(offer)
    if (!label) continue

    const id = typeof offer.adId === 'string' && offer.adId.trim()
      ? offer.adId.trim()
      : `${label.toLowerCase()}::${targetUrl}`

    if (seen.has(id)) continue
    seen.add(id)

    entries.push({
      id,
      label,
      labelLower: label.toLowerCase(),
      offer,
    })
  }

  return entries.sort((a, b) => b.label.length - a.label.length)
})

const offerMap = computed(() => {
  const map = new Map()
  for (const entry of inlineOfferEntries.value) {
    map.set(entry.id, entry.offer)
  }
  return map
})

const activeOffer = computed(() => {
  if (!activeOfferId.value) return null
  return offerMap.value.get(activeOfferId.value) || null
})

const renderedHtml = computed(() => {
  const baseHtml = renderMarkdown(props.content)
  return injectInlineOffers(baseHtml, inlineOfferEntries.value)
})

function resolveInlineOfferLabel(offer) {
  const candidates = [
    typeof offer.entityText === 'string' ? offer.entityText : '',
    typeof offer.title === 'string' ? offer.title : '',
  ]
  for (const candidate of candidates) {
    const label = candidate.trim()
    if (label) return label
  }
  return ''
}

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

function injectInlineOffers(html, offers) {
  if (!html || !Array.isArray(offers) || offers.length === 0) return html
  if (typeof window === 'undefined' || typeof window.DOMParser !== 'function') return html

  const parser = new window.DOMParser()
  const doc = parser.parseFromString(`<div id="__inline_offers_root__">${html}</div>`, 'text/html')
  const root = doc.getElementById('__inline_offers_root__')
  if (!root) return html

  const walker = doc.createTreeWalker(root, window.NodeFilter.SHOW_TEXT)
  const textNodes = []
  let current = walker.nextNode()
  while (current) {
    textNodes.push(current)
    current = walker.nextNode()
  }

  for (const node of textNodes) {
    if (!node?.nodeValue) continue
    if (shouldSkipNode(node.parentElement)) continue
    replaceTextNodeWithInlineOffers(doc, node, offers)
  }

  return root.innerHTML
}

function shouldSkipNode(el) {
  const blocked = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE'])
  let current = el
  while (current) {
    if (blocked.has(current.tagName)) return true
    current = current.parentElement
  }
  return false
}

function replaceTextNodeWithInlineOffers(doc, textNode, offers) {
  const original = textNode.nodeValue || ''
  if (!original.trim()) return

  const fragment = doc.createDocumentFragment()
  let cursor = 0
  const lower = original.toLowerCase()

  while (cursor < original.length) {
    const match = findNextOfferMatch(original, lower, cursor, offers)
    if (!match) {
      fragment.appendChild(doc.createTextNode(original.slice(cursor)))
      break
    }

    if (match.index > cursor) {
      fragment.appendChild(doc.createTextNode(original.slice(cursor, match.index)))
    }

    const marker = doc.createElement('span')
    marker.className = 'inline-offer-marker'
    marker.setAttribute('data-offer-id', match.entry.id)
    marker.textContent = original.slice(match.index, match.index + match.length)
    fragment.appendChild(marker)

    cursor = match.index + match.length
  }

  textNode.parentNode?.replaceChild(fragment, textNode)
}

function findNextOfferMatch(original, lower, cursor, offers) {
  let best = null

  for (const entry of offers) {
    const index = findMatchIndexWithBoundary(original, lower, entry.labelLower, cursor)
    if (index === -1) continue

    const candidate = {
      index,
      length: entry.label.length,
      entry,
    }

    if (
      !best ||
      candidate.index < best.index ||
      (candidate.index === best.index && candidate.length > best.length)
    ) {
      best = candidate
    }
  }

  return best
}

function findMatchIndexWithBoundary(original, lower, needle, start) {
  let searchFrom = start
  while (searchFrom < lower.length) {
    const index = lower.indexOf(needle, searchFrom)
    if (index === -1) return -1
    if (isBoundaryMatch(original, index, needle.length)) return index
    searchFrom = index + needle.length
  }
  return -1
}

function isBoundaryMatch(text, index, length) {
  const prev = index > 0 ? text[index - 1] : ''
  const next = index + length < text.length ? text[index + length] : ''
  const first = text[index] || ''
  const last = text[index + length - 1] || ''

  if (isWordChar(first) && isWordChar(prev)) return false
  if (isWordChar(last) && isWordChar(next)) return false
  return true
}

function isWordChar(char) {
  return /[A-Za-z0-9]/.test(char)
}

function findMarkerElement(target) {
  if (!(target instanceof Element)) return null
  return target.closest('[data-offer-id]')
}

function openPopoverForMarker(marker, { pinned = false } = {}) {
  const offerId = marker.getAttribute('data-offer-id') || ''
  if (!offerId || !offerMap.value.has(offerId)) return

  const wrapper = wrapperRef.value
  if (!(wrapper instanceof Element)) return

  const wrapperRect = wrapper.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  popoverPosition.value = {
    left: markerRect.left - wrapperRect.left + markerRect.width / 2,
    top: markerRect.top - wrapperRect.top - 8,
  }
  activeOfferId.value = offerId
  if (pinned) {
    pinnedOfferId.value = offerId
  }
}

function hidePopover(force = false) {
  if (!force && pinnedOfferId.value) return
  activeOfferId.value = ''
  if (force) {
    pinnedOfferId.value = ''
  }
}

function handleWrapperMouseOver(event) {
  const marker = findMarkerElement(event.target)
  if (!marker) return
  openPopoverForMarker(marker)
}

function handleWrapperMouseOut(event) {
  const marker = findMarkerElement(event.target)
  if (!marker) return

  const related = event.relatedTarget
  if (related instanceof Element) {
    if (marker.contains(related)) return
    if (popoverRef.value instanceof Element && popoverRef.value.contains(related)) return
  }

  if (!pinnedOfferId.value && !isPopoverHovered.value) {
    hidePopover()
  }
}

function handleWrapperClick(event) {
  const marker = findMarkerElement(event.target)
  if (!marker) return

  event.preventDefault()
  event.stopPropagation()

  const offerId = marker.getAttribute('data-offer-id') || ''
  if (pinnedOfferId.value === offerId) {
    hidePopover(true)
    return
  }

  openPopoverForMarker(marker, { pinned: true })
}

function handlePopoverMouseEnter() {
  isPopoverHovered.value = true
}

function handlePopoverMouseLeave() {
  isPopoverHovered.value = false
  if (!pinnedOfferId.value) {
    hidePopover()
  }
}

function handlePopoverLinkClick() {
  if (!activeOffer.value) return
  emit('ad-click', activeOffer.value)
}

function handleDocumentClick(event) {
  const wrapper = wrapperRef.value
  if (!(wrapper instanceof Element)) return
  if (event.target instanceof Element && wrapper.contains(event.target)) return
  hidePopover(true)
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    hidePopover(true)
  }
}

onMounted(() => {
  window.addEventListener('click', handleDocumentClick, true)
  window.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleDocumentClick, true)
  window.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<style scoped>
.markdown-content-wrapper {
  position: relative;
  display: inline;
}

.markdown-content {
  word-wrap: break-word;
  display: inline;
}

.markdown-content :deep(.inline-offer-marker) {
  position: relative;
  border-bottom: 1px solid #9ca3af;
  cursor: pointer;
  transition: border-color 0.12s ease;
}

.markdown-content :deep(.inline-offer-marker:hover) {
  border-bottom-color: #6b7280;
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

.inline-offer-popover {
  position: absolute;
  z-index: 30;
  min-width: 220px;
  max-width: 320px;
  border-radius: 10px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  padding: 8px 10px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
  transform: translate(-50%, -100%);
}

.inline-offer-popover-title {
  display: block;
  font-size: 12px;
  color: #374151;
  margin-bottom: 4px;
}

.inline-offer-popover-link {
  color: #1d4ed8;
  font-size: 12px;
  text-decoration: underline;
}
</style>
