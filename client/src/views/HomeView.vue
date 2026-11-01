<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type SiteDayCost } from "../api";
import { isValidDate, longDate } from "../dates";
import DayPicker from "../components/DayPicker.vue";
import ShiftHours from "../components/ShiftHours.vue";
import { useSitesStore } from "../stores/sites";

const store = useSitesStore();
const route = useRoute();
const router = useRouter();

/** Selected day: ?date= in the URL, else the first day in the data. */
const date = computed<string>({
  get: () => (isValidDate(route.query.date) ? route.query.date : store.firstDate ?? ""),
  set: (v) => {
    const query = { ...route.query };
    if (v && v !== store.firstDate) query.date = v;
    else delete query.date;
    router.replace({ query });
  },
});

const outsideData = computed(() => {
  const asked = route.query.date;
  return isValidDate(asked) && !!store.firstDate && !!store.lastDate && (asked < store.firstDate || asked > store.lastDate);
});
const invalidDate = computed(() => route.query.date !== undefined && !isValidDate(route.query.date) && !!store.firstDate);

const costs = ref<Record<string, SiteDayCost>>({});
const errors = ref<Record<string, string>>({});
const loading = ref(false);
let request = 0;

watch(
  [() => store.sites, date],
  async ([sites, d]) => {
    const id = ++request;
    costs.value = {};
    errors.value = {};
    if (!d || !sites.length) return;
    loading.value = true;
    await Promise.all(
      sites.map(async (s) => {
        try {
          const c = await api.siteDayCost(s.id, d);
          if (id === request) costs.value[s.id] = c;
        } catch (e) {
          if (id === request) errors.value[s.id] = (e as Error).message;
        }
      }),
    );
    if (id === request) loading.value = false;
  },
  { immediate: true },
);

const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const kwh = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })} kWh`;
const hasDay = (h: { first_date: string | null; last_date: string | null }) =>
  !!date.value && !!h.first_date && !!h.last_date && h.first_date <= date.value && date.value <= h.last_date;
const hallCost = (siteId: string, hallId: string) => costs.value[siteId]?.halls.find((h) => h.hall_id === hallId);
/** The server's reason names the schedule by its internal name. */
const reasonText = (reason?: string) => (reason?.includes("schedule") ? "No optimized schedule for this hall" : "No data for this day");
const hasHalls = computed(() => store.sites.some((s) => s.halls.length));
</script>

<template>
  <h1>Sites</h1>

  <p v-if="store.error" class="error">
    {{ store.error }}
    <button type="button" class="retry" @click="store.load(true)">Try again</button>
  </p>

  <div v-if="store.days.length" class="date-picker">
    Day
    <DayPicker v-model="date" :days="store.days" />
    <span class="muted">
      Energy cost of the optimized schedule
      <template v-if="store.firstDate">· data from {{ store.firstDate }} to {{ store.lastDate }}</template>
    </span>
  </div>

  <p v-if="invalidDate" class="date-notice">That isn't a valid date, so the first day with data is shown.</p>
  <p v-else-if="outsideData" class="date-notice">
    There is no data for that day. The data covers {{ longDate(store.firstDate!) }} to {{ longDate(store.lastDate!) }}.
    <RouterLink :to="{ name: 'home' }">Go to the first day</RouterLink>
  </p>

  <p v-if="!store.loading && !store.error && !store.sites.length" class="muted">No sites are assigned to your account. Ask an administrator for access.</p>
  <p v-else-if="hasHalls && !store.days.length" class="muted">No data has been recorded for these halls yet, so there are no costs to show.</p>

  <section v-for="site in store.sites" :key="site.id" class="card">
    <header class="site-head">
      <h2>{{ site.name }} <span class="muted">· {{ site.city }}</span></h2>
      <div v-if="site.halls.length" class="site-total">
        <template v-if="errors[site.id]"><span class="error">{{ errors[site.id] }}</span></template>
        <template v-else-if="!costs[site.id]"><span class="muted">{{ loading ? "Loading cost…" : "" }}</span></template>
        <template v-else-if="costs[site.id].total_cost_eur === null"><span class="muted">No cost for {{ date }}</span></template>
        <template v-else>
          <strong>{{ eur(costs[site.id].total_cost_eur!) }}</strong>
          <span class="muted"> on {{ costs[site.id].date }}</span>
          <span v-if="!costs[site.id].complete" class="muted"> (not all halls)</span>
        </template>
      </div>
    </header>

    <p v-if="!site.halls.length" class="muted">This site has no halls yet.</p>
    <table v-else>
      <thead>
        <tr><th>Hall</th><th>Shift</th><th>Optimized cost</th><th>Energy</th><th>Feasible</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="hall in site.halls" :key="hall.id">
          <td>
            <RouterLink :to="{ name: 'hall', params: { hallId: hall.id } }">{{ hall.name }}</RouterLink>
            <div v-if="hall.notes" class="muted small">{{ hall.notes }}</div>
          </td>
          <td>
            <ShiftHours v-if="hall.shifts?.length" :shifts="hall.shifts" />
            <span v-else class="muted">–</span>
          </td>
          <template v-if="hallCost(site.id, hall.id)?.cost_eur != null">
            <td>{{ eur(hallCost(site.id, hall.id)!.cost_eur!) }}</td>
            <td>{{ kwh(hallCost(site.id, hall.id)!.energy_kwh!.total) }}</td>
            <td>
              {{ hallCost(site.id, hall.id)!.feasible ? "yes" : `no (${hallCost(site.id, hall.id)!.n_violations})` }}
            </td>
          </template>
          <td v-else-if="hallCost(site.id, hall.id)" colspan="3" class="muted">{{ reasonText(hallCost(site.id, hall.id)!.reason) }}</td>
          <td v-else colspan="3" class="muted">–</td>
          <td class="day-link">
            <RouterLink
              v-if="hasDay(hall)"
              :to="{ name: 'hall-day', params: { hallId: hall.id, date }, query: { schedule: 'optimized' } }"
            >Day view ›</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.date-picker { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.site-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.site-head h2 { margin: 0 0 8px; }
.site-total strong { font-size: 20px; }
.small { font-size: 13px; }
.date-notice { margin: 12px 0 0; }
.day-link { text-align: right; white-space: nowrap; }
</style>
