<script setup lang="ts">
import { ref, watch } from "vue";
import { api, ApiError, type DayCost, type HallDetail } from "../api";
import DayPicker from "../components/DayPicker.vue";
import TermHelp from "../components/TermHelp.vue";

const props = defineProps<{ hallId: string }>();

const hall = ref<HallDetail | null>(null);
const date = ref<string>("");
const cost = ref<DayCost | null>(null);
const error = ref<string | null>(null);
const notFound = ref(false);
const costLoading = ref(false);

const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const kwh = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })} kWh`;

/** Leaves out what a hall doesn't have, such as a date range before it has data. */
const subtitle = (h: HallDetail) =>
  [h.notes, h.timezone, h.first_date && `${h.first_date} – ${h.last_date}`].filter(Boolean).join(" · ");

let hallRequest = 0;
async function loadHall() {
  const req = ++hallRequest;
  hall.value = null;
  error.value = null;
  notFound.value = false;
  try {
    const h = await api.hall(props.hallId);
    if (req !== hallRequest) return;
    hall.value = h;
    date.value = h.first_date ?? "";
  } catch (e) {
    if (req !== hallRequest) return;
    if (e instanceof ApiError && e.status === 404) notFound.value = true;
    else error.value = (e as Error).message;
  }
}

let costRequest = 0;
async function loadCost() {
  const req = ++costRequest;
  const h = hall.value;
  const d = date.value;
  cost.value = null;
  costLoading.value = false;
  if (!h || !d || !h.schedules.length) return;
  error.value = null;
  costLoading.value = true;
  try {
    const c = await api.dayCost(h.id, d);
    if (req === costRequest) cost.value = c;
  } catch (e) {
    if (req === costRequest) error.value = e instanceof ApiError && e.status === 400 ? `No cost is available for ${d}.` : (e as Error).message;
  } finally {
    if (req === costRequest) costLoading.value = false;
  }
}

const retry = () => (hall.value ? loadCost() : loadHall());

watch(() => props.hallId, () => loadHall(), { immediate: true });
watch([hall, date], loadCost);
</script>

<template>
  <template v-if="notFound">
    <p class="error">We couldn't find that hall.</p>
    <RouterLink to="/">Back to Sites</RouterLink>
  </template>
  <p v-if="error" class="error">
    {{ error }}
    <button type="button" class="retry" @click="retry">Try again</button>
  </p>
  <template v-if="hall">
    <h1>{{ hall.name }}</h1>
    <p class="muted">{{ subtitle(hall) }}</p>

    <template v-if="hall.days.length">
      Day
      <DayPicker v-model="date" :days="hall.days" />
      <RouterLink v-if="date" class="day-link" :to="{ name: 'hall-day', params: { hallId: hall.id, date } }">
        Day chart for {{ date }} ›
      </RouterLink>
    </template>

    <p v-if="!hall.days.length" class="muted">No data has been recorded for this hall yet, so there is no cost to show.</p>
    <p v-else-if="!hall.schedules.length" class="muted">This hall has no schedules yet, so there is no cost to show.</p>
    <section v-else-if="cost" class="card">
      <h2>Cost on {{ cost.date }}</h2>
      <table>
        <thead>
          <tr><th>Schedule</th><th>Cost</th><th>Fan</th><th>Heating</th><th>Cooling</th><th>Energy</th><th><TermHelp term="feasible">Feasible</TermHelp></th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, name) in cost.schedules" :key="name">
            <td><TermHelp v-if="name === 'baseline' || name === 'optimized'" :term="name">{{ name }}</TermHelp><template v-else>{{ name }}</template></td>
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
    <p v-else-if="costLoading" class="muted">Loading cost…</p>
  </template>
</template>

<style scoped>
.day-link { margin-left: 16px; }
</style>
