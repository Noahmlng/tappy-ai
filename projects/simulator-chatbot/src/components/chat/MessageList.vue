<template>
  <div>
    <div
      class="cubic-bezier-transition shrink-0 transition-all duration-[700ms]"
      :class="hasStarted ? 'max-h-0' : 'max-h-[35vh] flex-grow'"
    ></div>

    <div
      class="cubic-bezier-transition shrink-0 flex flex-col items-center transition-all duration-[700ms]"
      :class="hasStarted ? 'mb-0 max-h-0 scale-95 overflow-hidden opacity-0' : 'mb-8 max-h-20 scale-100 opacity-100'"
    >
      <h1 class="chat-hero-title">How can I help you today?</h1>
      <p class="chat-hero-subtitle">Ask, iterate, and validate answers in one clean conversation flow.</p>
    </div>

    <div
      class="chat-message-stream transition-all duration-[700ms]"
      :class="hasStarted ? 'py-8 opacity-100' : 'max-h-0 overflow-hidden opacity-0'"
    >
      <MessageItem
        v-for="msg in currentMessages"
        :key="msg.id"
        :msg="msg"
        :is-loading="isLoading"
        :query-rewrite-message-id="queryRewriteMessageId"
        :query-rewrite-draft="queryRewriteDraft"
        :format-tool-state="formatToolState"
        :get-host-label="getHostLabel"
        :resolve-message-content-for-rendering="resolveMessageContentForRendering"
        :resolve-inline-offers-for-message="resolveInlineOffersForMessage"
        :resolve-ad-href="resolveAdHref"
        :is-debug-mode="isDebugMode"
        @start-query-rewrite-edit="$emit('start-query-rewrite-edit', $event)"
        @cancel-query-rewrite-edit="$emit('cancel-query-rewrite-edit')"
        @update:query-rewrite-draft="$emit('update:queryRewriteDraft', $event)"
        @submit-query-rewrite="$emit('submit-query-rewrite', $event)"
        @inline-offer-click="$emit('inline-offer-click', $event)"
        @inline-marker-count="$emit('inline-marker-count', $event)"
        @regenerate="$emit('regenerate', $event)"
        @source-click="$emit('source-click', $event)"
        @sponsored-ad-click="$emit('sponsored-ad-click', $event)"
        @follow-up-select="$emit('follow-up-select', $event)"
        @next-step-ad-click="$emit('next-step-ad-click', $event)"
        @next-step-ad-dismiss="$emit('next-step-ad-dismiss', $event)"
      />

      <div class="h-4"></div>
    </div>
  </div>
</template>

<script setup>
import MessageItem from './MessageItem.vue'

defineProps({
  hasStarted: {
    type: Boolean,
    default: false,
  },
  currentMessages: {
    type: Array,
    default: () => [],
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
</script>
