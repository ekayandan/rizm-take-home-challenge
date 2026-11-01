<script setup lang="ts">
/**
 * History of every intervention on the user's sites, newest first, with who made it, when and
 * why. Revoked interventions stay listed. Times are in the timezone of the hall concerned.
 */
import { onMounted, ref } from "vue";
import { api, type Asset, type Intervention } from "../api";
import { formatInstant, formatRange } from "../timestamps";

const ASSET_LABELS: Record<Asset, string> = { fan: "Fan", boiler: "Boiler", chiller: "Chiller" };

const items = ref<Intervention[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    items.value = await api.interventions();
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <h1>Intervention history</h1>
  <section class="card">
    <p v-if="loadError" class="error">{{ loadError }}</p>
    <p v-else-if="loading" class="muted">Loading history…</p>
    <p v-else-if="!items.length" class="muted">No interventions recorded.</p>
    <table v-else>
      <thead>
        <tr><th>Plant</th><th>Hall</th><th>Unit disabled</th><th>Disabled</th><th>User</th><th>Added</th><th>Reason</th></tr>
      </thead>
      <tbody>
        <tr v-for="i in items" :key="i.id">
          <td>{{ i.site_name }}</td>
          <td>{{ i.hall_name }}</td>
          <td>{{ ASSET_LABELS[i.asset] ?? i.asset }}</td>
          <td>{{ formatRange(i.start_utc, i.end_utc, i.timezone) }}</td>
          <td>{{ i.created_by_name }}</td>
          <td>{{ formatInstant(i.created_at, i.timezone) }}</td>
          <td>
            {{ i.reason }}
            <div v-if="i.revoked_at" class="muted revoked">
              Revoked {{ formatInstant(i.revoked_at, i.timezone) }} by {{ i.revoked_by_name }}: {{ i.revoke_reason }}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.revoked { font-size: 12px; margin-top: 2px; }
</style>
