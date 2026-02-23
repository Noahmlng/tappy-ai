<template>
  <header class="chat-topbar">
    <div class="chat-topbar-left">
      <button
        v-if="!isSidebarOpen"
        class="chat-topbar-toggle"
        @click="$emit('open-sidebar')"
      >
        <Menu :size="20" />
      </button>
      <div class="chat-topbar-chip">live simulator</div>
      <div class="chat-topbar-title">{{ title }}</div>
    </div>

    <button
      class="chat-topbar-action"
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
