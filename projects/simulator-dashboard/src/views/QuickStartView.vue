<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Onboarding</p>
      <h2>Quick Start</h2>
      <p class="subtitle">
        Two-step integration path. Detailed code samples are planned in `DASH-A-003`.
      </p>
    </header>

    <div class="grid">
      <article class="panel">
        <h3>Step 1: Prepare env</h3>
        <pre class="code-block">MEDIATION_API_BASE_URL=&lt;base_url&gt;
MEDIATION_API_KEY=&lt;api_key&gt;
PLACEMENT_ID=&lt;placement_id&gt;</pre>
      </article>

      <article class="panel">
        <h3>Step 2: Validate first request</h3>
        <pre class="code-block">POST /api/v1/sdk/evaluate
POST /api/v1/sdk/events</pre>
      </article>
    </div>
  </section>
</template>
