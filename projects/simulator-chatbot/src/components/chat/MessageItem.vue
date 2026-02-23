<template>
  <div
    :class="[
      'chat-message animate-in',
      msg.role === 'user' ? 'is-user' : ''
    ]"
  >
    <div class="flex-shrink-0">
      <div
        v-if="msg.role === 'assistant' && msg.kind !== 'tool'"
        class="chat-avatar assistant"
      >
        <Bot :size="18" class="text-white" />
      </div>
      <div
        v-else-if="msg.role === 'assistant' && msg.kind === 'tool'"
        class="chat-avatar tool"
      >
        <Search :size="16" />
      </div>
      <div
        v-else
        class="chat-avatar"
      >
        <UserCircle :size="18" />
      </div>
    </div>

    <div
      :class="[
        'chat-bubble text-[15px] leading-7',
        msg.role === 'user'
          ? 'chat-bubble-user'
          : 'chat-bubble-assistant'
      ]"
    >
      <div v-if="msg.role === 'user'" class="leading-normal">
        <template v-if="queryRewriteMessageId === msg.id">
          <textarea
            :value="queryRewriteDraft"
            rows="2"
            class="chat-user-edit"
            @input="$emit('update:queryRewriteDraft', $event.target.value)"
            @keydown.esc.prevent="$emit('cancel-query-rewrite-edit')"
          ></textarea>
          <div class="chat-user-actions">
            <button
              class="chat-user-btn"
              @click="$emit('cancel-query-rewrite-edit')"
            >
              Cancel
            </button>
            <button
              class="chat-user-btn primary disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="!queryRewriteDraft.trim() || isLoading"
              @click="$emit('submit-query-rewrite', msg)"
            >
              Rewrite & Run
            </button>
          </div>
        </template>

        <template v-else>
          <div class="whitespace-pre-wrap">{{ msg.content }}</div>
          <div class="mt-2 flex justify-end">
            <button
              class="chat-rewrite-btn disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isLoading"
              @click="$emit('start-query-rewrite-edit', msg)"
            >
              <PenSquare :size="12" />
              <span>Edit & Rewrite</span>
            </button>
          </div>
        </template>
      </div>

      <div v-else class="leading-normal">
        <template v-if="msg.kind === 'tool'">
          <div class="chat-tool-card text-sm">
            <div class="chat-tool-head">
              <span class="font-semibold">Tool</span>
              <span class="chat-tool-name">web_search</span>
              <span class="ml-auto chat-pill" :class="toolStateClass(msg.toolState)">{{ formatToolState(msg.toolState) }}</span>
            </div>

            <div v-if="msg.toolQuery" class="chat-tool-query">Query: "{{ msg.toolQuery }}"</div>

            <div v-if="msg.toolState === 'running'" class="chat-tool-meta inline-flex items-center gap-2">
              <LoaderCircle :size="12" class="animate-spin" />
              <span>Searching web...</span>
            </div>

            <div v-if="msg.toolState === 'error'" class="chat-tool-error">
              {{ msg.toolError || 'Tool execution failed.' }}
            </div>

            <div v-if="msg.toolState === 'done' && msg.toolLatencyMs !== null" class="chat-tool-meta">
              Finished in {{ msg.toolLatencyMs }} ms
            </div>

            <ul v-if="msg.toolResults?.length" class="chat-tool-results">
              <li v-for="(result, idx) in msg.toolResults" :key="result.id || idx" class="chat-tool-result">
                <a
                  :href="result.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="chat-tool-link text-sm"
                >
                  {{ idx + 1 }}. {{ result.title }}
                </a>
                <p class="chat-tool-snippet">{{ result.snippet }}</p>
                <p class="chat-tool-host">{{ getHostLabel(result.url) }}</p>
              </li>
            </ul>
          </div>
        </template>

        <template v-else-if="msg.status === 'reasoning' && !msg.content">
          <div class="chat-reasoning">
            <LoaderCircle :size="14" class="animate-spin" />
            <span>Reasoning...</span>
          </div>
        </template>

        <template v-if="msg.kind !== 'tool' && msg.content">
          <MarkdownRenderer
            :key="`${msg.id}:${msg.attachAdSlot?.requestId || ''}:${msg.attachAdSlot?.ads?.length || 0}`"
            :content="resolveMessageContentForRendering(msg)"
            :inline-offers="resolveInlineOffersForMessage(msg)"
            @ad-click="(ad) => $emit('inline-offer-click', { msg, ad })"
            @inline-marker-count="(count) => $emit('inline-marker-count', { msg, count })"
          />
          <span
            v-if="msg.status === 'streaming'"
            class="cursor-blink ml-0.5 inline-block h-5 w-0.5 bg-gray-800 align-middle"
          ></span>
        </template>

        <div
          v-if="msg.kind !== 'tool' && msg.role === 'assistant' && msg.status === 'done' && msg.sourceUserContent"
          class="chat-regen-row"
        >
          <button
            class="chat-regen-btn disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isLoading"
            @click="$emit('regenerate', msg)"
          >
            Regenerate
          </button>
          <span class="chat-regen-note">Retry #{{ msg.retryCount }}</span>
        </div>

        <CitationSources
          v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.sources?.length"
          :sources="msg.sources"
          @source-click="(source) => $emit('source-click', { msg, source })"
        />

        <div
          v-if="isDebugMode && msg.kind !== 'tool' && msg.status === 'done' && msg.attachAdSlot?.ads?.length"
          class="chat-sponsored-card"
        >
          <div class="chat-sponsored-head">
            <span class="chat-sponsored-label">
              Sponsored
            </span>
            <span class="chat-sponsored-place">{{ msg.attachAdSlot.placementId || 'chat_inline_v1' }}</span>
          </div>
          <ul class="chat-sponsored-list">
            <li
              v-for="ad in msg.attachAdSlot.ads"
              :key="ad.adId"
              class="chat-sponsored-item"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-[#1f2937]">
                    {{ ad.entityText || ad.title || 'Sponsored result' }}
                  </p>
                  <p v-if="ad.description" class="mt-1 text-xs text-[#566176]">
                    {{ ad.description }}
                  </p>
                  <p v-if="ad.sourceNetwork" class="mt-1 text-[10px] uppercase tracking-wide text-[#8b93ab]">
                    {{ ad.sourceNetwork }}
                  </p>
                </div>
                <a
                  :href="resolveAdHref(ad)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="chat-sponsored-open shrink-0 font-medium"
                  @click="$emit('sponsored-ad-click', { msg, ad })"
                >
                  Open
                </a>
              </div>
            </li>
          </ul>
        </div>

        <FollowUpSuggestions
          v-if="isDebugMode && msg.kind !== 'tool' && msg.status === 'done' && msg.followUps?.length"
          :items="msg.followUps"
          :disabled="isLoading"
          @select="$emit('follow-up-select', $event)"
        />

        <IntentCard
          v-if="isDebugMode && msg.kind !== 'tool' && msg.status === 'done' && msg.nextStepAdSlot?.ads?.length && !msg.nextStepAdSlot?.dismissedAt"
          :slot-data="msg.nextStepAdSlot"
          :max-items="3"
          @click-item="(ad) => $emit('next-step-ad-click', { msg, ad })"
          @dismiss="$emit('next-step-ad-dismiss', msg)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  Bot,
  LoaderCircle,
  PenSquare,
  Search,
  UserCircle,
} from 'lucide-vue-next'

import CitationSources from '../CitationSources.vue'
import FollowUpSuggestions from '../FollowUpSuggestions.vue'
import IntentCard from '../IntentCard.vue'
import MarkdownRenderer from '../MarkdownRenderer.vue'

defineProps({
  msg: {
    type: Object,
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  queryRewriteMessageId: {
    type: String,
    default: '',
  },
  queryRewriteDraft: {
    type: String,
    default: '',
  },
  formatToolState: {
    type: Function,
    required: true,
  },
  getHostLabel: {
    type: Function,
    required: true,
  },
  resolveMessageContentForRendering: {
    type: Function,
    required: true,
  },
  resolveInlineOffersForMessage: {
    type: Function,
    required: true,
  },
  resolveAdHref: {
    type: Function,
    required: true,
  },
  isDebugMode: {
    type: Boolean,
    default: false,
  },
})

defineEmits([
  'start-query-rewrite-edit',
  'cancel-query-rewrite-edit',
  'update:queryRewriteDraft',
  'submit-query-rewrite',
  'inline-offer-click',
  'inline-marker-count',
  'regenerate',
  'source-click',
  'sponsored-ad-click',
  'follow-up-select',
  'next-step-ad-click',
  'next-step-ad-dismiss',
])

function toolStateClass(toolState) {
  if (toolState === 'running' || toolState === 'planning') return 'running'
  if (toolState === 'error') return 'error'
  if (toolState === 'done') return 'done'
  return 'neutral'
}
</script>
