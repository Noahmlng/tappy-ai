<template>
  <section class="page">
    <header class="page-header">
      <p class="eyebrow">Credentials</p>
      <h2>API Keys</h2>
      <p class="subtitle">
        Key lifecycle page skeleton. Create/rotate/revoke wiring is next.
      </p>
    </header>

    <article class="panel">
      <div class="panel-toolbar">
        <h3>Keys</h3>
        <button class="button" type="button" disabled>
          Create key
        </button>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Environment</th>
            <th>Status</th>
            <th>Last used</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>primary-staging</td>
            <td>staging</td>
            <td>active</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>
