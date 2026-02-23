<template>
  <div
    :class="[
      'animate-in flex gap-3',
      msg.role === 'user' ? 'flex-row-reverse items-start' : 'flex-row items-start'
    ]"
  >
    <div class="mt-1 flex-shrink-0">
      <div
        v-if="msg.role === 'assistant' && msg.kind !== 'tool'"
        class="flex h-8 w-8 items-center justify-center rounded-full border border-[#0f8f70] bg-[#10a37f] shadow-sm"
      >
        <Bot :size="18" class="text-white" />
      </div>
      <div
        v-else-if="msg.role === 'assistant' && msg.kind === 'tool'"
        class="flex h-8 w-8 items-center justify-center rounded-full border border-[#d7d7d7] bg-[#f4f4f4] shadow-sm"
      >
        <Search :size="16" class="text-[#5f6368]" />
      </div>
      <div
        v-else
        class="flex h-8 w-8 items-center justify-center rounded-full bg-[#ececec] shadow-sm"
      >
        <UserCircle :size="18" class="text-[#737373]" />
      </div>
    </div>

    <div
      :class="[
        'min-h-[44px] max-w-[78%] px-4 py-2.5 text-[15px] leading-7',
        msg.role === 'user'
          ? 'rounded-3xl rounded-tr-md border border-[#d9dee7] bg-[var(--chat-user-bg)] text-[#1f2430]'
          : 'rounded-2xl rounded-tl-sm bg-[var(--chat-assistant-bg)] text-[#1f2430]'
      ]"
    >
      <div v-if="msg.role === 'user'" class="leading-normal">
        <template v-if="queryRewriteMessageId === msg.id">
          <textarea
            :value="queryRewriteDraft"
            rows="2"
            class="w-full resize-y rounded-xl border border-[#d8d8d8] bg-white px-3 py-2 text-[14px] leading-normal text-[#202123] outline-none focus:border-[#b8b8b8]"
            @input="$emit('update:queryRewriteDraft', $event.target.value)"
            @keydown.esc.prevent="$emit('cancel-query-rewrite-edit')"
          ></textarea>
          <div class="mt-2 flex items-center justify-end gap-2">
            <button
              class="rounded-lg border border-[#d1d1d1] px-2 py-1 text-[11px] text-[#52525b] hover:bg-[#f3f4f6]"
              @click="$emit('cancel-query-rewrite-edit')"
            >
              Cancel
            </button>
            <button
              class="rounded-lg border border-[#111111] bg-[#111111] px-2 py-1 text-[11px] text-white hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-60"
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
              class="inline-flex items-center gap-1 rounded-lg border border-[#d7d7d7] bg-white px-2 py-1 text-[11px] text-[#5f6368] hover:bg-[#f6f7f8] disabled:cursor-not-allowed disabled:opacity-60"
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
          <div class="chat-exec-card rounded-2xl px-3 py-2 text-sm">
            <div class="flex items-center gap-2 text-xs uppercase tracking-wide text-[#6b7280]">
              <span class="font-semibold">Tool</span>
              <span class="rounded-md bg-[#ececec] px-1.5 py-0.5 text-[10px] text-[#4b5563]">web_search</span>
              <span class="ml-auto chat-pill" :class="toolStateClass(msg.toolState)">{{ formatToolState(msg.toolState) }}</span>
            </div>

            <div v-if="msg.toolQuery" class="mt-2 text-[13px] text-[#4b5563]">Query: "{{ msg.toolQuery }}"</div>

            <div v-if="msg.toolState === 'running'" class="mt-2 inline-flex items-center gap-2 text-xs text-[#6b7280]">
              <LoaderCircle :size="12" class="animate-spin" />
              <span>Searching web...</span>
            </div>

            <div v-if="msg.toolState === 'error'" class="mt-2 text-xs text-red-600">
              {{ msg.toolError || 'Tool execution failed.' }}
            </div>

            <div v-if="msg.toolState === 'done' && msg.toolLatencyMs !== null" class="mt-2 text-[11px] text-[#6b7280]">
              Finished in {{ msg.toolLatencyMs }} ms
            </div>

            <ul v-if="msg.toolResults?.length" class="mt-2 space-y-2">
              <li v-for="(result, idx) in msg.toolResults" :key="result.id || idx" class="rounded-xl border border-[#e7e7e7] bg-white p-2">
                <a
                  :href="result.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm font-medium text-[#2f5bd3] hover:underline"
                >
                  {{ idx + 1 }}. {{ result.title }}
                </a>
                <p class="mt-1 text-xs text-[#4b5563]">{{ result.snippet }}</p>
                <p class="mt-1 text-[11px] text-[#9ca3af]">{{ getHostLabel(result.url) }}</p>
              </li>
            </ul>
          </div>
        </template>

        <template v-else-if="msg.status === 'reasoning' && !msg.content">
          <div class="inline-flex items-center gap-2 text-sm text-[#6b7280]">
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
          class="mt-2 flex items-center gap-2"
        >
          <button
            class="rounded-lg border border-[#d8d8d8] bg-white px-2 py-1 text-[11px] text-[#5f6368] hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isLoading"
            @click="$emit('regenerate', msg)"
          >
            Regenerate
          </button>
          <span class="text-[10px] text-[#9ca3af]">Retry #{{ msg.retryCount }}</span>
        </div>

        <CitationSources
          v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.sources?.length"
          :sources="msg.sources"
          @source-click="(source) => $emit('source-click', { msg, source })"
        />

        <div
          v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.attachAdSlot?.ads?.length"
          class="mt-3 rounded-2xl border border-[#dfe3f2] bg-[#f8f9ff] p-3"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="rounded-full bg-[#eef2ff] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#4758c7]">
              Sponsored
            </span>
            <span class="text-[10px] text-[#7b839f]">{{ msg.attachAdSlot.placementId || 'chat_inline_v1' }}</span>
          </div>
          <ul class="space-y-2">
            <li
              v-for="ad in msg.attachAdSlot.ads"
              :key="ad.adId"
              class="rounded-xl border border-[#e5e9f7] bg-white p-2.5"
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
                  class="shrink-0 rounded-lg border border-[#cad3f3] bg-[#f3f6ff] px-2 py-1 text-[11px] font-medium text-[#2d4fd8] hover:bg-[#e9efff]"
                  @click="$emit('sponsored-ad-click', { msg, ad })"
                >
                  Open
                </a>
              </div>
            </li>
          </ul>
        </div>

        <FollowUpSuggestions
          v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.followUps?.length"
          :items="msg.followUps"
          :disabled="isLoading"
          @select="$emit('follow-up-select', $event)"
        />

        <IntentCard
          v-if="msg.kind !== 'tool' && msg.status === 'done' && msg.nextStepAdSlot?.ads?.length && !msg.nextStepAdSlot?.dismissedAt"
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
