<template>
  <div
    class="chat-composer-shell cubic-bezier-transition transition-all duration-[220ms]"
    :class="hasStarted ? 'mt-auto pb-4 pt-2' : 'pb-8'"
  >
    <div class="mx-auto max-w-[920px] px-4">
      <div class="chat-composer relative flex flex-col p-2">
        <Textarea
          :value="modelValue"
          rows="1"
          placeholder="Message simulator"
          class="chat-composer-input"
          style="min-height: 44px"
          @input="$emit('update:modelValue', $event.target.value)"
          @compositionstart="$emit('composition-start')"
          @compositionend="$emit('composition-end')"
          @keydown.enter.prevent="$emit('send')"
        />

        <div class="flex items-center justify-end px-2 pb-1">
          <Button
            size="icon"
            :variant="String(modelValue || '').trim() && !isLoading ? 'default' : 'outline'"
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
          </Button>
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
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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
