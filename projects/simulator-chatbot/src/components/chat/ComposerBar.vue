<template>
  <div
    class="cubic-bezier-transition sticky bottom-0 z-20 w-full bg-gradient-to-t from-white via-white to-white/90 transition-all duration-[700ms]"
    :class="hasStarted ? 'mt-auto pb-5 pt-2' : 'pb-8'"
  >
    <div class="mx-auto max-w-[760px] px-4">
      <div class="chat-composer relative flex flex-col p-2 transition-all duration-300 focus-within:border-[#b4bfd2]">
        <textarea
          :value="modelValue"
          rows="1"
          placeholder="Message Chat Bot"
          class="max-h-52 w-full resize-none border-none bg-transparent py-3 pl-4 pr-24 text-[16px] text-[#1f2430] outline-none focus:outline-none focus:ring-0 placeholder:text-[#98a1af]"
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
              'rounded-full p-2.5 outline-none transition-all',
              String(modelValue || '').trim() && !isLoading
                ? 'bg-[#111111] text-white hover:bg-[#2a2a2a]'
                : 'cursor-not-allowed bg-[#ebebeb] text-[#b8b8b8]'
            ]"
            @click="$emit('send')"
          >
            <ArrowUp :size="18" :stroke-width="3" />
          </button>
        </div>
      </div>

      <div class="mt-3 text-center">
        <p class="select-none text-[11px] text-[#8f8f95]">Chat Bot can make mistakes. Check important info.</p>
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
