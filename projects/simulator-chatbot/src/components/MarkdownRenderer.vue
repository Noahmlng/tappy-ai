<template>
  <div
    ref="wrapperRef"
    class="markdown-content-wrapper"
    @mouseover="handleWrapperMouseOver"
    @mouseout="handleWrapperMouseOut"
    @click="handleWrapperClick"
  >
    <div class="markdown-content" v-html="renderedHtml"></div>
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
        :href="resolveOfferHref(activeOffer)"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-offer-popover-link"
        @click.stop="handlePopoverLinkClick"
      >
        Open Link
      </a>
    </span>
  </div>
</template>

<script setup>
import MarkdownIt from 'markdown-it'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

const emit = defineEmits(['ad-click', 'inline-marker-count'])

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

    const href = resolveOfferHref(offer)
    if (!href) continue

    const labels = resolveInlineOfferLabels(offer)
    if (labels.length === 0) continue

    const id = typeof offer.adId === 'string' && offer.adId.trim()
      ? offer.adId.trim()
      : `${labels[0].toLowerCase()}::${href}`

    if (seen.has(id)) continue
    seen.add(id)

    entries.push({
      id,
      labels: labels.map((item) => ({
        text: item,
        lower: item.toLowerCase(),
        compact: compactAlnum(item),
      })),
      offer,
    })
  }

  return entries.sort((a, b) => maxEntryLabelLength(b) - maxEntryLabelLength(a))
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

function maxEntryLabelLength(entry) {
  if (!entry || !Array.isArray(entry.labels)) return 0
  return entry.labels.reduce((max, item) => Math.max(max, item?.text?.length || 0), 0)
}

function normalizeLabelText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function splitLabelWords(value) {
  return normalizeLabelText(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolveInlineOfferLabels(offer) {
  const suffixes = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'co', 'plc', 'gmbh'])
  const seen = new Set()
  const labels = []

  const pushLabel = (value) => {
    const label = normalizeLabelText(value)
    if (!label) return
    const compact = label.replace(/[^A-Za-z0-9]/g, '')
    if (compact.length < 4) return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    labels.push(label)
  }

  const pushVariants = (value) => {
    const words = splitLabelWords(value)
    if (words.length === 0) return

    pushLabel(value)
    pushLabel(words.join(' '))
    pushLabel(words.join(''))

    let trimmed = [...words]
    while (trimmed.length > 1 && suffixes.has(trimmed[trimmed.length - 1].toLowerCase())) {
      trimmed = trimmed.slice(0, -1)
    }
    if (trimmed.length > 0) {
      pushLabel(trimmed.join(' '))
      pushLabel(trimmed.join(''))
    }

    if (trimmed.length > 1 && trimmed[trimmed.length - 1].toLowerCase() === 'ai') {
      const withoutAi = trimmed.slice(0, -1)
      pushLabel(withoutAi.join(' '))
      pushLabel(withoutAi.join(''))
    }
  }

  const candidates = [
    typeof offer.entityText === 'string' ? offer.entityText : '',
    typeof offer.title === 'string' ? offer.title : '',
  ]

  for (const candidate of candidates) {
    pushVariants(candidate)
  }

  return labels
}

function resolveOfferHref(offer) {
  if (!offer || typeof offer !== 'object') return ''
  const tracking = offer.tracking && typeof offer.tracking === 'object' ? offer.tracking : {}
  const candidates = [
    tracking.clickUrl,
    tracking.click_url,
    offer.clickUrl,
    offer.click_url,
    offer.targetUrl,
    offer.target_url,
  ]
  for (const value of candidates) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text) return text
  }
  return ''
}

function compactAlnum(value) {
  if (typeof value !== 'string') return ''
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function renderMarkdown(text) {
  return markdownParser.render(String(text || ''))
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

  rewriteExistingAnchorLinks(root, offers)

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

function rewriteExistingAnchorLinks(root, offers) {
  const anchors = root.querySelectorAll('a[href]')
  if (!anchors || anchors.length === 0) return

  for (const anchor of anchors) {
    const text = typeof anchor.textContent === 'string' ? anchor.textContent.trim() : ''
    if (!text) continue

    const lower = text.toLowerCase()
    const matched = findBestAnchorOfferMatch(text, lower, offers)
    if (!matched) continue

    const href = resolveOfferHref(matched.entry.offer)
    if (!href) continue

    anchor.setAttribute('href', href)
    anchor.setAttribute('data-offer-id', matched.entry.id)
    anchor.classList.add('inline-offer-marker')
  }
}

function findBestAnchorOfferMatch(original, lower, offers) {
  let best = null
  const compactIndex = buildCompactIndex(original)

  for (const entry of offers) {
    for (const label of Array.isArray(entry.labels) ? entry.labels : []) {
      const rawMatch = findRawMatch(original, lower, label.lower, 0)
      const compactMatch = findCompactMatch(original, compactIndex, label.compact, 0)
      const candidate = pickBetterMatch(rawMatch, compactMatch)
      if (!candidate) continue

      const enriched = {
        index: candidate.index,
        length: candidate.length,
        entry,
      }

      if (
        !best ||
        enriched.index < best.index ||
        (enriched.index === best.index && enriched.length > best.length)
      ) {
        best = enriched
      }
    }
  }

  return best
}

function replaceTextNodeWithInlineOffers(doc, textNode, offers) {
  const original = textNode.nodeValue || ''
  if (!original.trim()) return

  const fragment = doc.createDocumentFragment()
  let cursor = 0
  const lower = original.toLowerCase()
  const compactIndex = buildCompactIndex(original)

  while (cursor < original.length) {
    const match = findNextOfferMatch(original, lower, compactIndex, cursor, offers)
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

function findNextOfferMatch(original, lower, compactIndex, cursor, offers) {
  let best = null

  for (const entry of offers) {
    for (const label of Array.isArray(entry.labels) ? entry.labels : []) {
      const rawMatch = findRawMatch(original, lower, label.lower, cursor)
      const compactMatch = findCompactMatch(original, compactIndex, label.compact, cursor)
      const candidate = pickBetterMatch(rawMatch, compactMatch)
      if (!candidate) continue

      const enriched = {
        index: candidate.index,
        length: candidate.length,
        entry,
      }

      if (
        !best ||
        enriched.index < best.index ||
        (enriched.index === best.index && enriched.length > best.length)
      ) {
        best = enriched
      }
    }
  }

  return best
}

function findRawMatch(original, lower, needle, start) {
  if (!needle) return null
  const index = findMatchIndexWithBoundary(original, lower, needle, start)
  if (index === -1) return null
  return {
    index,
    length: needle.length,
  }
}

function buildCompactIndex(original) {
  const chars = []
  const mapToOriginal = []

  for (let i = 0; i < original.length; i += 1) {
    const char = original[i]
    if (!/[A-Za-z0-9]/.test(char)) continue
    chars.push(char.toLowerCase())
    mapToOriginal.push(i)
  }

  return {
    compact: chars.join(''),
    mapToOriginal,
  }
}

function findCompactStartPosition(mapToOriginal, originalCursor) {
  for (let i = 0; i < mapToOriginal.length; i += 1) {
    if (mapToOriginal[i] >= originalCursor) return i
  }
  return mapToOriginal.length
}

function findCompactMatch(original, compactIndex, compactNeedle, start) {
  if (!compactNeedle) return null

  const compactText = compactIndex?.compact || ''
  const mapToOriginal = Array.isArray(compactIndex?.mapToOriginal)
    ? compactIndex.mapToOriginal
    : []
  if (!compactText || mapToOriginal.length === 0) return null

  let compactStart = findCompactStartPosition(mapToOriginal, start)
  while (compactStart <= compactText.length) {
    const matchPos = compactText.indexOf(compactNeedle, compactStart)
    if (matchPos === -1) return null

    const firstOriginalIndex = mapToOriginal[matchPos]
    const lastOriginalIndex = mapToOriginal[matchPos + compactNeedle.length - 1]
    if (!Number.isFinite(firstOriginalIndex) || !Number.isFinite(lastOriginalIndex)) return null

    const length = lastOriginalIndex - firstOriginalIndex + 1
    if (isBoundaryMatch(original, firstOriginalIndex, length)) {
      return {
        index: firstOriginalIndex,
        length,
      }
    }

    compactStart = matchPos + compactNeedle.length
  }

  return null
}

function pickBetterMatch(left, right) {
  if (!left) return right
  if (!right) return left
  if (left.index !== right.index) return left.index < right.index ? left : right
  if (left.length !== right.length) return left.length > right.length ? left : right
  return left
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

function countInlineMarkers(html) {
  if (typeof html !== 'string') return 0
  const matches = html.match(/data-offer-id=/g)
  return Array.isArray(matches) ? matches.length : 0
}

watch(
  renderedHtml,
  (html) => {
    emit('inline-marker-count', countInlineMarkers(html))
  },
  { immediate: true },
)

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
  display: block;
}

.markdown-content {
  word-wrap: break-word;
  display: block;
}

.markdown-content :deep(.inline-offer-marker) {
  position: relative;
  border-bottom: none;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: #9ca3af;
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
  background: linear-gradient(180deg, transparent 72%, rgba(156, 163, 175, 0.2) 72%);
  cursor: pointer;
  transition: text-decoration-color 0.12s ease, background-color 0.12s ease;
}

.markdown-content :deep(.inline-offer-marker:hover) {
  text-decoration-color: #4b5563;
  background: linear-gradient(180deg, transparent 68%, rgba(107, 114, 128, 0.24) 68%);
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

.markdown-content :deep(p) {
  margin: 0 0 0.75em;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
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

.markdown-content :deep(blockquote) {
  margin: 0.75em 0;
  border-left: 3px solid #d1d5db;
  padding-left: 0.75em;
  color: #4b5563;
}

.markdown-content :deep(hr) {
  border: 0;
  border-top: 1px solid #e5e7eb;
  margin: 0.9em 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 6px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: #f8fafc;
  font-weight: 600;
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
