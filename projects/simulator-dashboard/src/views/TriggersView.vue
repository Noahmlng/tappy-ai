<script setup>
import { dashboardState, updateTriggerNumber } from '../state/dashboard-state'
</script>

<template>
  <section>
    <header class="section-head">
      <div>
        <p class="eyebrow">Configuration</p>
        <h2>Trigger Parameters</h2>
      </div>
      <p class="muted">All thresholds are tenant-defined. Platform should enforce min/max guardrails in API.</p>
    </header>

    <article class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Placement ID</th>
            <th>Intent Threshold (0-1)</th>
            <th>Cooldown (seconds)</th>
            <th>Min Expected Revenue (USD)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="placement in dashboardState.placements" :key="placement.placementId">
            <td>{{ placement.placementId }}</td>
            <td>
              <input
                class="input"
                type="number"
                min="0"
                max="1"
                step="0.01"
                :value="placement.trigger.intentThreshold"
                @change="updateTriggerNumber(placement.placementId, 'intentThreshold', $event.target.value)"
              >
            </td>
            <td>
              <input
                class="input"
                type="number"
                min="0"
                step="1"
                :value="placement.trigger.cooldownSeconds"
                @change="updateTriggerNumber(placement.placementId, 'cooldownSeconds', $event.target.value)"
              >
            </td>
            <td>
              <input
                class="input"
                type="number"
                min="0"
                step="0.01"
                :value="placement.trigger.minExpectedRevenue"
                @change="updateTriggerNumber(placement.placementId, 'minExpectedRevenue', $event.target.value)"
              >
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
