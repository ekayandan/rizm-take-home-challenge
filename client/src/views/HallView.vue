<script setup lang="ts">
import { ref, watch } from "vue";
import { api, type DayCost, type HallDetail } from "../api";
import DayPicker from "../components/DayPicker.vue";

const props = defineProps<{ hallId: string }>();

const hall = ref<HallDetail | null>(null);
const date = ref<string>("");
const cost = ref<DayCost | null>(null);
const error = ref<string | null>(null);

const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const kwh = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })} kWh`;

watch(
  () => props.hallId,
  async (id) => {
    hall.value = null;
    cost.value = null;
    error.value = null;
    try {
      hall.value = await api.hall(id);
      date.value = hall.value.first_date ?? "";
    } catch (e) {
      error.value = (e as Error).message;
    }
  },
  { immediate: true },
);

watch([() => props.hallId, date], async ([id, d]) => {
  if (!d) return;
  cost.value = null;
  try {
    cost.value = await api.dayCost(id, d);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>
  <template v-if="hall">
    <h1>{{ hall.name }}</h1>
    <p class="muted">{{ hall.notes }} · {{ hall.timezone }} · {{ hall.first_date }} – {{ hall.last_date }}</p>

    Day
    <DayPicker v-model="date" :days="hall.days" />
    <RouterLink v-if="date" class="day-link" :to="{ name: 'hall-day', params: { hallId: hall.id, date } }">
      Day chart for {{ date }} ›
    </RouterLink>

    <section v-if="cost" class="card">
      <h2>Cost on {{ cost.date }}</h2>
      <table>
        <thead>
          <tr><th>Schedule</th><th>Cost</th><th>Fan</th><th>Heating</th><th>Cooling</th><th>Energy</th><th>Feasible</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, name) in cost.schedules" :key="name">
            <td>{{ name }}</td>
            <td>{{ eur(r.cost_eur) }}</td>
            <td>{{ eur(r.cost_breakdown_eur.fan) }}</td>
            <td>{{ eur(r.cost_breakdown_eur.heating) }}</td>
            <td>{{ eur(r.cost_breakdown_eur.cooling) }}</td>
            <td>{{ kwh(r.energy_kwh.total) }}</td>
            <td>{{ r.feasible ? "yes" : `no (${r.n_violations})` }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="cost.savings_eur !== undefined">Savings optimized vs. baseline: <strong>{{ eur(cost.savings_eur) }}</strong></p>
    </section>
    <p v-else class="muted">Loading cost…</p>
  </template>
</template>

<style scoped>
.day-link { margin-left: 16px; }
</style>
