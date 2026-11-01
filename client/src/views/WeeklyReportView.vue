<script setup lang="ts">
/**
 * A site's weekly report: the summary first, then a page per hall when printed. The CSV
 * download comes from the same report on the server.
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type ReportFigures, type WeeklyReport } from "../api";
import { useSitesStore } from "../stores/sites";
import { defaultWeek, reportWeeks } from "../weeks";

const props = defineProps<{ siteId: string }>();

const store = useSitesStore();
const route = useRoute();
const router = useRouter();

const site = computed(() => store.sites.find((s) => s.id === props.siteId));
const weeks = computed(() => (site.value ? reportWeeks(site.value.first_date, site.value.last_date) : []));

const week = computed<string>({
  get: () => {
    const q = route.query.week;
    return typeof q === "string" && weeks.value.some((w) => w.start === q) ? q : defaultWeek(weeks.value) ?? "";
  },
  set: (v) => { router.replace({ query: { ...route.query, week: v } }); },
});

const report = ref<WeeklyReport | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
let request = 0;

watch([() => props.siteId, week], async ([id, w]) => {
  const current = ++request;
  report.value = null;
  loadError.value = null;
  if (!w) return;
  loading.value = true;
  try {
    const r = await api.weeklyReport(id, w);
    if (current === request) report.value = r;
  } catch (e) {
    if (current === request) loadError.value = (e as Error).message;
  } finally {
    if (current === request) loading.value = false;
  }
}, { immediate: true });

const print = () => window.print();
const csvUrl = computed(() => api.weeklyReportCsvUrl(props.siteId, week.value));

const eur = (v: number | null) => (v === null ? "–" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const hours = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} h`;
const figureRows = (f: ReportFigures) => [
  { label: "Baseline cost", value: eur(f.baseline_eur) },
  { label: "Optimized plan cost", value: eur(f.optimized_eur) },
  { label: "Cost after interventions", value: eur(f.post_intervention_eur) },
  { label: "Savings against baseline", value: eur(f.savings_eur) },
  { label: "Hours out of bounds", value: hours(f.hours_out_of_bounds) },
];
</script>

<template>
  <h1>Weekly report<template v-if="site">: {{ site.name }}</template></h1>

  <div class="controls no-print">
    <label>
      Week
      <select v-model="week">
        <option v-for="w in weeks" :key="w.start" :value="w.start">
          {{ w.start }} to {{ w.end }}{{ w.partial ? " (partial)" : "" }}
        </option>
      </select>
    </label>
    <template v-if="report">
      <a class="button" :href="csvUrl" download>Download CSV</a>
      <button type="button" class="button" @click="print">Print</button>
    </template>
  </div>

  <p v-if="!store.loading && !site" class="error">This site was not found.</p>
  <p v-else-if="loadError" class="error">{{ loadError }}</p>
  <p v-else-if="loading" class="muted">Loading report…</p>

  <template v-if="report">
    <section class="card">
      <h2>Site summary</h2>
      <p>
        {{ report.week.start }} to {{ report.week.end }}
        <strong v-if="report.week.partial"> · Partial week: the data does not cover all of it</strong>
      </p>
      <div class="wide-table">
      <table>
        <thead>
          <tr>
            <th>Hall</th><th>Baseline</th><th>Optimized</th><th>After interventions</th><th>Savings</th>
            <th>Out of bounds</th><th>Hours covered</th><th>Interventions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in report.halls" :key="h.hall_id">
            <td>{{ h.name }}</td>
            <td>{{ eur(h.baseline_eur) }}</td>
            <td>{{ eur(h.optimized_eur) }}</td>
            <td>{{ eur(h.post_intervention_eur) }}</td>
            <td>{{ eur(h.savings_eur) }}</td>
            <td>{{ hours(h.hours_out_of_bounds) }}</td>
            <td>{{ hours(h.hours_covered) }}</td>
            <td>{{ h.interventions }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total">
            <td>Total</td>
            <td>{{ eur(report.summary.baseline_eur) }}</td>
            <td>{{ eur(report.summary.optimized_eur) }}</td>
            <td>{{ eur(report.summary.post_intervention_eur) }}</td>
            <td>{{ eur(report.summary.savings_eur) }}</td>
            <td>{{ hours(report.summary.hours_out_of_bounds) }}</td>
            <td>{{ hours(report.summary.hours_covered) }}</td>
            <td>{{ report.summary.interventions }}</td>
          </tr>
        </tfoot>
      </table>
      </div>

      <h3>Most expensive intervals</h3>
      <table>
        <thead><tr><th>#</th><th>Hall</th><th>Date</th><th>Time</th><th>Price</th><th>Cost</th></tr></thead>
        <tbody>
          <tr v-for="(i, n) in report.summary.top_intervals" :key="`${i.hall_id}-${i.ts_utc}`">
            <td>{{ n + 1 }}</td><td>{{ i.hall_name }}</td><td>{{ i.local_date }}</td><td>{{ i.local_time }}</td>
            <td>{{ i.price_eur_per_mwh.toLocaleString("de-DE") }} €/MWh</td><td>{{ eur(i.cost_eur) }}</td>
          </tr>
        </tbody>
      </table>

      <p class="muted note">
        Cost after interventions is the optimized plan with the maintenance windows now in force applied and nothing
        else re-planned. Hours out of bounds come from measured temperature and CO2; an interval counts once however
        many limits it breaks. Site totals add up the halls' hours.
      </p>
    </section>

    <section v-for="h in report.halls" :key="h.hall_id" class="card print-page">
      <h2>{{ h.name }}</h2>
      <p>{{ report.site.name }} · {{ report.week.start }} to {{ report.week.end }} · {{ hours(h.hours_covered) }} covered</p>
      <p v-if="!h.from" class="error">This hall has no data for this week.</p>
      <p v-if="h.hours_without_price" class="error">{{ hours(h.hours_without_price) }} without a price are not in these costs.</p>
      <table>
        <tbody>
          <tr v-for="row in figureRows(h)" :key="row.label"><th scope="row">{{ row.label }}</th><td>{{ row.value }}</td></tr>
          <tr><th scope="row">Interventions</th><td>{{ h.interventions }}</td></tr>
        </tbody>
      </table>

      <h3>Most expensive intervals</h3>
      <table>
        <thead><tr><th>#</th><th>Date</th><th>Time</th><th>Price</th><th>Cost</th></tr></thead>
        <tbody>
          <tr v-for="(i, n) in h.top_intervals" :key="i.ts_utc">
            <td>{{ n + 1 }}</td><td>{{ i.local_date }}</td><td>{{ i.local_time }}</td>
            <td>{{ i.price_eur_per_mwh.toLocaleString("de-DE") }} €/MWh</td><td>{{ eur(i.cost_eur) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </template>
</template>

<style scoped>
.controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.button { font: inherit; font-size: 14px; padding: 5px 12px; border: 1px solid #c4c9d0; border-radius: 6px; background: #fff; color: inherit; text-decoration: none; cursor: pointer; }
.wide-table { overflow-x: auto; }
th, td { font-size: 13px; padding: 6px 5px; }
.total td { font-weight: 600; border-top: 2px solid #1d232a; }
h2 { margin-top: 0; }
.note { font-size: 13px; margin-bottom: 0; }
</style>
