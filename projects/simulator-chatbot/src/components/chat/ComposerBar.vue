<template>
  <div
    class="chat-composer-shell cubic-bezier-transition transition-all duration-[700ms]"
    :class="hasStarted ? 'mt-auto pb-5 pt-2' : 'pb-8'"
  >
    <div class="mx-auto max-w-[860px] px-4">
      <div class="chat-composer relative flex flex-col p-2">
        <textarea
          :value="modelValue"
          rows="1"
          placeholder="Message Chat Bot"
          class="chat-composer-input"
          style="min-height: 44px"
          @input="$emit('update:modelValue', $event.target.value)"
          @compositionstart="$emit('composition-start')"
          @compositionend="$emit('composition-end')"
          @keydown.enter.prevent="$emit('send')"
        ></textarea>

        <div class="flex items-center justify-end px-2 pb-1">
          <button
            :disabled="!String(modelValue || '').trim() || isLoading"
            :class="[
              'chat-send-btn outline-none',
              String(modelValue || '').trim() && !isLoading
                ? 'active'
                : 'disabled'
            ]"
            @click="$emit('send')"
          >
            <ArrowUp :size="18" :stroke-width="3" />
          </button>
        </div>
      </div>

      <div class="mt-3 text-center">
        <p class="chat-disclaimer select-none">Chat Bot can make mistakes. Check important info.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ArrowUp } from 'lucide-vue-next'

defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  hasStarted: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['update:modelValue', 'send', 'composition-start', 'composition-end'])
</script>
