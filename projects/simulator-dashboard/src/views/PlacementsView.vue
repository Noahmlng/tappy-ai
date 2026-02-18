<script setup>
import {
  dashboardState,
  setPlacementEnabled,
  updateFrequencyCap,
  updatePlacementNumber,
} from '../state/dashboard-state'
</script>

<template>
  <section>
    <header class="section-head">
      <div>
        <p class="eyebrow">Configuration</p>
        <h2>Placement Controls</h2>
      </div>
      <p class="muted">
        Enabled, priority, and frequency caps are editable by integrator admins.
        Current config version: <strong>{{ dashboardState.placementConfigVersion }}</strong>
      </p>
    </header>

    <article class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Enabled</th>
            <th>Placement ID</th>
            <th>Key</th>
            <th>Surface</th>
            <th>Config Ver</th>
            <th>Priority</th>
            <th>Max / Session</th>
            <th>Max / User / Day</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="placement in dashboardState.placements" :key="placement.placementId">
            <td>
              <input
                type="checkbox"
                :checked="placement.enabled"
                @change="setPlacementEnabled(placement.placementId, $event.target.checked)"
              >
            </td>
            <td>{{ placement.placementId }}</td>
            <td>{{ placement.placementKey }}</td>
            <td>{{ placement.surface }}</td>
            <td>{{ placement.configVersion || '-' }}</td>
            <td>
              <input
                class="input"
                type="number"
                min="0"
                :value="placement.priority"
                @change="updatePlacementNumber(placement.placementId, 'priority', $event.target.value, 0)"
              >
            </td>
            <td>
              <input
                class="input"
                type="number"
                min="0"
                :value="placement.frequencyCap.maxPerSession"
                @change="updateFrequencyCap(placement.placementId, 'maxPerSession', $event.target.value)"
              >
            </td>
            <td>
              <input
                class="input"
                type="number"
                min="0"
                :value="placement.frequencyCap.maxPerUserPerDay"
                @change="updateFrequencyCap(placement.placementId, 'maxPerUserPerDay', $event.target.value)"
              >
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
