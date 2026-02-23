<template>
  <header class="z-30 flex h-14 shrink-0 items-center justify-between border-b border-[#e6e8ec] bg-white/92 px-4 backdrop-blur-md">
    <div class="flex items-center gap-2">
      <button
        v-if="!isSidebarOpen"
        class="hidden rounded-lg p-2 text-[#5f6370] hover:bg-[#f1f3f7] lg:block"
        @click="$emit('open-sidebar')"
      >
        <Menu :size="20" />
      </button>
      <div class="rounded-full border border-[#d9dee6] px-2.5 py-1 text-xs font-semibold text-[#4f5662]">{{ title }}</div>
    </div>

    <button
      class="inline-flex items-center gap-1 rounded-full border border-[#d9dee6] px-2.5 py-1 text-xs font-medium text-[#3f4652] transition-colors hover:bg-[#f4f6fa]"
      @click="$emit('start-new-chat')"
    >
      <Plus :size="13" />
      <span>New</span>
    </button>
  </header>
</template>

<script setup>
import { Menu, Plus } from 'lucide-vue-next'

defineProps({
  isSidebarOpen: {
    type: Boolean,
    default: true,
  },
  title: {
    type: String,
    default: 'Chat Bot',
  },
})

defineEmits(['open-sidebar', 'start-new-chat'])
</script>
