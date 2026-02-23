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

    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        :class="['chat-topbar-action', { 'is-active': isDebugMode }]"
        @click="$emit('toggle-debug')"
      >
        <Bug :size="13" />
        <span>Debug {{ isDebugMode ? 'On' : 'Off' }}</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="chat-topbar-action"
        @click="$emit('start-new-chat')"
      >
        <Plus :size="13" />
        <span>New</span>
      </Button>
    </div>
  </header>
</template>

<script setup>
import { Bug, Menu, Plus } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

defineProps({
  isSidebarOpen: {
    type: Boolean,
    default: true,
  },
  title: {
    type: String,
    default: 'Chat Bot',
  },
  isDebugMode: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['open-sidebar', 'start-new-chat', 'toggle-debug'])
</script>
