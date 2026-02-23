<script setup>
import UiCard from '../components/ui/UiCard.vue'
import UiSectionHeader from '../components/ui/UiSectionHeader.vue'
</script>

<template>
  <section class="page">
    <UiSectionHeader
      eyebrow="Internal Tooling"
      title="Internal Reset"
      subtitle="This route is gated by `VITE_ENABLE_INTERNAL_RESET` and hidden from external users."
    />

    <UiCard class="warning">
      <h3>Internal-only area</h3>
      <p>Reset and snapshot controls will be added in `DASH-D-*` tasks.</p>
    </UiCard>
  </section>
</template>
