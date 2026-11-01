<script setup lang="ts">
/**
 * Hall day view: one hall, one local day. Chart of spot price, controls and the simulated
 * indoor climate of the selected schedule, with the schedule's cost for that day, and the
 * hall's maintenance windows (form to add one, list of all).
 * URL: /halls/:hallId/days/:date?schedule=baseline|optimized
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, type DayCostTraced, type HallDetail, type HallSeries, type MeasuredViolation } from "../api";
import { isValidDate, longDate, shortDate } from "../dates";
import { useSitesStore } from "../stores/sites";
import DayChart, { type ChartPanel, type ChartViolation } from "../components/DayChart.vue";
import DayPicker from "../components/DayPicker.vue";
import MaintenancePanel from "../components/MaintenancePanel.vue";
import BreachList from "../components/BreachList.vue";
import TermHelp from "../components/TermHelp.vue";
import { amount, missingReadingsNote, num, readingCoverage } from "../violations";

const props = defineProps<{ hallId: string; date: string }>();
const route = useRoute();
const router = useRouter();
const store = useSitesStore();

const SCHEDULE_LABELS: Record<string, string> = { baseline: "Baseline", optimized: "Optimized" };
const label = (s: string) => SCHEDULE_LABELS[s] ?? s;

const hall = ref<HallDetail | null>(null);
const series = ref<HallSeries | null>(null);
const costs = ref<Record<string, DayCostTraced>>({});
const measuredBreaches = ref<MeasuredViolation[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const notFound = ref(false);

const schedules = computed(() => {
  const names = hall.value?.schedules ?? [];
  const order = ["baseline", "optimized"];
  return [...names].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
});

/** Shown schedule: ?schedule= if the hall has it, else optimized, else the first one. */
const schedule = computed<string>({
  get: () => {
    const q = route.query.schedule;
    if (typeof q === "string" && schedules.value.includes(q)) return q;
    return schedules.value.includes("optimized") ? "optimized" : schedules.value[0] ?? "";
  },
  set: (v) => router.replace({ query: { ...route.query, schedule: v } }),
});

const validDate = computed(() => isValidDate(props.date));
const hallName = computed(() => hall.value?.name ?? store.hallName(props.hallId) ?? "Hall");

/** Why this date has nothing to show; hall.days holds exactly the days with price data. */
const dayNotice = computed(() => {
  const h = hall.value;
  if (!h) return null;
  if (!validDate.value) return "That isn't a valid date.";
  if (!h.first_date || !h.last_date) return `No data has been recorded for ${h.name} yet.`;
  if (props.date < h.first_date || props.date > h.last_date) {
    return `There is no data for ${longDate(props.date)}. The data for ${h.name} covers ${longDate(h.first_date)} to ${longDate(h.last_date)}.`;
  }
  if (!h.days.some((d) => d.date === props.date)) {
    return `No price data for ${h.name} on ${shortDate(props.date)}, so cost and plan can't be calculated.`;
  }
  return null;
});

let hallRequest = 0;
async function loadHall() {
  const req = ++hallRequest;
  hall.value = null;
  error.value = null;
  notFound.value = false;
  try {
    const h = await api.hall(props.hallId);
    if (req === hallRequest) hall.value = h;
  } catch (e) {
    if (req !== hallRequest) return;
    if (e instanceof ApiError && e.status === 404) notFound.value = true;
    else error.value = (e as Error).message;
  }
}

// Load the day's series and the traced cost of every schedule, so switching is instant.
let request = 0;
async function loadDay() {
  const req = ++request;
  loading.value = false;
  series.value = null;
  costs.value = {};
  measuredBreaches.value = [];
  if (!hall.value) return;
  error.value = null;
  const names = schedules.value;
  if (!names.length || dayNotice.value) return;
  const id = props.hallId;
  const date = props.date;
  loading.value = true;
  try {
    const [s, v, ...reports] = await Promise.all([
      api.series(id, date),
      api.violations(id, date),
      ...names.map((n) => api.scheduleDayCost(id, date, n)),
    ]);
    if (req !== request) return;
    series.value = s;
    measuredBreaches.value = v.violations;
    costs.value = Object.fromEntries(names.map((n, i) => [n, reports[i]]));
  } catch (e) {
    if (req === request) error.value = e instanceof ApiError && e.status === 400 ? "There is no data for this day." : (e as Error).message;
  } finally {
    if (req === request) loading.value = false;
  }
}

const retry = () => (hall.value ? loadDay() : loadHall());

watch(() => props.hallId, () => loadHall(), { immediate: true });
watch([hall, () => props.date], loadDay, { immediate: true });

/** Nearest days with data, also from a day that has none. An invalid date only gets the first day. */
const prevDay = computed(() => (validDate.value ? hall.value?.days.filter((d) => d.date < props.date).at(-1)?.date ?? null : null));
const nextDay = computed(() => (validDate.value ? hall.value?.days.find((d) => d.date > props.date)?.date : hall.value?.days[0]?.date) ?? null);
const goToDay = (date: string) => router.push({ name: "hall-day", params: { hallId: props.hallId, date }, query: route.query });

const shown = computed(() => costs.value[schedule.value] ?? null);
const baseline = computed(() => (schedule.value !== "baseline" ? costs.value.baseline ?? null : null));

const STATE_TEMP = new Set(["temp_below_min", "temp_above_max"]);
const DIRECTION: Record<string, string> = { temp_below_min: "below", temp_above_max: "above", co2_above_max: "above" };
const breachNote = (source: string, constraint: string, over: number) =>
  constraint === "co2_above_max"
    ? `${source} ${amount(over, 0)} ppm ${DIRECTION[constraint]} limit`
    : `${source} ${amount(over, 2)} °C ${DIRECTION[constraint]} limit`;

/** Line 0 of a climate panel is measured, line 1 the shown schedule's simulation. */
function panelViolations(pred: (c: string) => boolean): ChartViolation[] {
  const r = shown.value;
  const start = series.value?.step_start ?? 0;
  return [
    ...measuredBreaches.value
      .filter((v) => pred(v.constraint))
      .map((v) => ({ index: v.step - start, line: 0, note: breachNote("Measured", v.constraint, v.over) })),
    ...(r?.violations ?? [])
      .filter((v) => pred(v.constraint))
      .map((v) => ({
        index: v.step - r!.step_start,
        line: 1,
        note: breachNote("Simulated", v.constraint, Math.abs((v.value as number) - (v.limit as number))),
      })),
  ];
}

const measuredSummary = computed(() => {
  const dtMin = series.value?.dt_minutes ?? 15;
  const worst = (pred: (c: string) => boolean) => {
    const hits = measuredBreaches.value.filter((v) => pred(v.constraint));
    return hits.length ? { hours: (hits.length * dtMin) / 60, over: Math.max(...hits.map((v) => v.over)) } : null;
  };
  return { temp: worst((c) => STATE_TEMP.has(c)), co2: worst((c) => c === "co2_above_max") };
});

const measuredOk = computed(() => !measuredSummary.value.temp && !measuredSummary.value.co2);
const readingsNote = computed(() => (series.value ? missingReadingsNote(readingCoverage(series.value)) : null));

const controlViolations = computed(
  () => (shown.value?.violations ?? []).filter((v) => !STATE_TEMP.has(v.constraint) && v.constraint !== "co2_above_max").length,
);

const C = {
  price: "#495057",
  flow: "#5f3dc4",
  recirc: "#0c8599",
  heat: "#d9480f",
  cool: "#1c7ed6",
  temp: "#c2255c",
  co2: "#2b8a3e",
};

const times = computed(() => {
  const s = series.value;
  if (!s) return [];
  const t = s.local_time.map((x) => x.slice(11, 16));
  // end-of-day state point: next local midnight
  return [...t, "24:00"];
});

const panels = computed<ChartPanel[]>(() => {
  const s = series.value;
  const r = shown.value;
  const sc = s?.schedules[schedule.value];
  if (!s || !r || !sc) return [];
  const h = hall.value;
  return [
    {
      id: "price", title: "Spot price", term: "spotPrice", unit: "€/MWh", height: 90,
      lines: [{ label: "Price", color: C.price, values: s.series.price_eur_per_mwh, kind: "step", digits: 2 }],
      include: [0],
    },
    {
      id: "flow", title: "Fan mass flow", term: "massFlow", unit: "kg/s", height: 80,
      lines: [{ label: "Mass flow", color: C.flow, values: sc.mass_flow_kg_per_s, kind: "step", area: true, digits: 2 }],
      include: [0, ...(h?.hvac.max_mass_flow_kg_per_s ? [h.hvac.max_mass_flow_kg_per_s] : [])],
    },
    {
      id: "recirc", title: "Recirculation", term: "recirculation", unit: "share of supply air", height: 70,
      lines: [{ label: "Recirculation", color: C.recirc, values: sc.recirculation, kind: "step", area: true, digits: 2 }],
      include: [0, h?.hvac.max_recirculation ?? 1],
    },
    {
      id: "power", title: "Heating and cooling", term: "thermalPower", unit: "kW thermal", height: 100,
      lines: [
        { label: "Heating", color: C.heat, values: sc.heating_kw, kind: "step", area: true },
        { label: "Cooling", color: C.cool, values: sc.cooling_kw, kind: "step", area: true },
      ],
      include: [0],
    },
    {
      id: "temp", title: "Indoor temperature", term: "temperature", unit: "°C", height: 130,
      lines: [
        { label: "Measured", color: C.temp, values: s.measured.temperature_c, kind: "state" },
        { label: "Simulated", color: C.temp, values: r.trace.temperature_c, kind: "state", dashed: true },
      ],
      bands: [{ label: "Allowed", lower: s.bounds.temp_min_c, upper: s.bounds.temp_max_c }],
      violations: panelViolations((c) => STATE_TEMP.has(c)),
    },
    {
      id: "co2", title: "Indoor CO₂", term: "co2", unit: "ppm", height: 110,
      lines: [
        { label: "Measured", color: C.co2, values: s.measured.co2_ppm, kind: "state", digits: 0 },
        { label: "Simulated", color: C.co2, values: r.trace.co2_ppm, kind: "state", digits: 0, dashed: true },
      ],
      bands: [{ label: "Allowed", upper: s.bounds.co2_max_ppm }],
      violations: panelViolations((c) => c === "co2_above_max"),
    },
  ];
});

const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const kwh = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })} kWh`;
const pct = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
</script>

<template>
  <template v-if="notFound">
    <p class="error">We couldn't find that hall.</p>
    <RouterLink to="/">Back to Sites</RouterLink>
  </template>
  <template v-else>
  <nav class="crumbs">
    <RouterLink to="/">Sites</RouterLink> ›
    <RouterLink :to="{ name: 'hall', params: { hallId } }">{{ hallName }}</RouterLink> ›
    <span>{{ date }}</span>
  </nav>
  <h1>{{ hallName }} <span class="muted">· {{ date }}</span></h1>

  <div class="toolbar">
    <div class="day-nav">
      <button type="button" :disabled="!prevDay" aria-label="Previous day" @click="prevDay && goToDay(prevDay)">‹</button>
      <DayPicker v-if="hall?.days.length" :model-value="date" :days="hall.days" @update:model-value="goToDay" />
      <button type="button" :disabled="!nextDay" aria-label="Next day" @click="nextDay && goToDay(nextDay)">›</button>
    </div>
    <div v-if="schedules.length" class="segmented" role="radiogroup" aria-label="Schedule">
      <button
        v-for="s in schedules"
        :key="s"
        type="button"
        role="radio"
        :aria-checked="s === schedule"
        :class="{ active: s === schedule }"
        @click="schedule = s"
      >{{ label(s) }}</button>
    </div>
    <TermHelp term="schedule" class="schedule-help" />
    <span v-if="hall" class="muted small">{{ hall.timezone }} · local time</span>
  </div>

  <p v-if="error" class="error">
    {{ error }}
    <button type="button" class="retry" @click="retry">Try again</button>
  </p>
  <p v-else-if="dayNotice" class="day-notice">
    {{ dayNotice }}
    <template v-if="prevDay || nextDay">
      <span class="muted">{{ validDate ? "Nearest days with data:" : "Go to:" }}</span>
      <RouterLink v-if="prevDay" class="near-day" :to="{ name: 'hall-day', params: { hallId, date: prevDay }, query: route.query }">‹ {{ shortDate(prevDay) }}</RouterLink>
      <RouterLink v-if="nextDay" class="near-day" :to="{ name: 'hall-day', params: { hallId, date: nextDay }, query: route.query }">{{ shortDate(nextDay) }} ›</RouterLink>
    </template>
  </p>
  <p v-else-if="hall && !schedules.length" class="muted">This hall has no schedules, so there is no plan or cost to show.</p>

  <div v-if="!error && !dayNotice && !(hall && !schedules.length)" class="day-grid">
    <section class="card chart-card">
      <p v-if="loading || !series" class="muted">Loading day…</p>
      <DayChart v-else :times="times" :panels="panels" />
    </section>

    <section class="card cost-card" aria-label="Cost of the shown schedule">
      <template v-if="shown">
        <h2>{{ label(schedule) }} schedule</h2>
        <div class="cost">{{ eur(shown.cost_eur) }}</div>
        <div class="muted small">energy cost on {{ date }} at spot price</div>

        <table>
          <tbody>
            <tr><th>Fan</th><td>{{ eur(shown.cost_breakdown_eur.fan) }}</td><td class="muted">{{ kwh(shown.energy_kwh.fan) }}</td></tr>
            <tr><th>Heating</th><td>{{ eur(shown.cost_breakdown_eur.heating) }}</td><td class="muted">{{ kwh(shown.energy_kwh.heating) }}</td></tr>
            <tr><th>Cooling</th><td>{{ eur(shown.cost_breakdown_eur.cooling) }}</td><td class="muted">{{ kwh(shown.energy_kwh.cooling) }}</td></tr>
            <tr class="total"><th>Total</th><td>{{ eur(shown.cost_eur) }}</td><td class="muted">{{ kwh(shown.energy_kwh.total) }}</td></tr>
          </tbody>
        </table>
        <p class="small muted">Purchased energy at the spot price: fan power, heating ÷ boiler efficiency, cooling ÷ chiller COP.<TermHelp term="efficiency" /></p>

        <p v-if="shown.feasible" class="ok">Plan: simulation stays within all comfort and equipment limits.</p>
        <p v-else class="error">
          Plan: {{ shown.n_violations }} limit violation{{ shown.n_violations === 1 ? "" : "s" }} in simulation
          <template v-if="controlViolations"> ({{ controlViolations }} equipment, not marked in the chart)</template>.
        </p>
        <div v-if="!measuredOk" class="error measured-breach">
          Sensors: comfort limits broken on this day, marked red in the chart.
          <ul>
            <li v-if="measuredSummary.temp">Temperature: {{ num(measuredSummary.temp.hours, 2) }} h, up to {{ amount(measuredSummary.temp.over, 2) }} °C past the limit</li>
            <li v-if="measuredSummary.co2">CO₂: {{ num(measuredSummary.co2.hours, 2) }} h, up to {{ amount(measuredSummary.co2.over, 0) }} ppm past the limit</li>
          </ul>
        </div>
        <p v-if="readingsNote" class="muted">Sensors: {{ readingsNote }}</p>
        <p v-else-if="measuredOk" class="ok">Sensors: measured climate stayed within limits.</p>

        <p v-if="baseline" class="compare">
          Baseline: {{ eur(baseline.cost_eur) }}<br />
          <strong>{{ baseline.cost_eur - shown.cost_eur >= 0 ? "Saves" : "Costs" }}
            {{ eur(Math.abs(baseline.cost_eur - shown.cost_eur)) }}</strong>
          <template v-if="baseline.cost_eur > 0"> ({{ pct((Math.abs(baseline.cost_eur - shown.cost_eur) / baseline.cost_eur) * 100) }})</template>
          {{ baseline.cost_eur - shown.cost_eur >= 0 ? "" : "more" }} vs. baseline
        </p>
        <p v-else-if="costs.optimized" class="compare muted">
          Optimized: {{ eur(costs.optimized.cost_eur) }}
        </p>
        <p class="small muted">
          Indoor climate is simulated from this schedule, starting from the state it reaches at local midnight.
        </p>
      </template>
      <p v-else-if="loading" class="muted">Loading cost…</p>
    </section>
  </div>

  <BreachList
    v-if="!error && series?.schedules[schedule]"
    :breaches="measuredBreaches"
    :series="series"
    :times="times"
    :plan="series.schedules[schedule]"
    :plan-label="label(schedule)"
  />

  <MaintenancePanel v-if="hall && validDate" :hall-id="hallId" :date="date" :timezone="hall.timezone" />
  </template>
</template>

<style scoped>
.crumbs { font-size: 13px; color: #6a737d; }
.crumbs a { color: inherit; }
h1 { margin: 6px 0 12px; }
.toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.day-nav { display: flex; align-items: center; gap: 4px; }
button { font: inherit; padding: 4px 10px; border: 1px solid #c9ced4; background: #fff; border-radius: 6px; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
.segmented { display: inline-flex; border: 1px solid #c9ced4; border-radius: 6px; overflow: hidden; }
.segmented button { border: 0; border-radius: 0; padding: 5px 14px; }
.segmented button + button { border-left: 1px solid #c9ced4; }
.segmented button.active { background: #1d232a; color: #fff; }
.schedule-help { margin-left: -12px; }
.day-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
.day-grid .card { margin: 16px 0 0; }
.chart-card { min-width: 0; }
.cost-card h2 { margin: 0 0 4px; font-size: 15px; }
.cost { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cost-card table { margin: 12px 0 4px; }
.cost-card th { font-weight: 400; padding-left: 0; }
.cost-card td { text-align: right; padding-right: 0; }
.cost-card tr.total th, .cost-card tr.total td:nth-child(2) { font-weight: 600; }
.compare { border-top: 1px solid #eef0f3; padding-top: 10px; }
.ok { color: #2b8a3e; }
.day-notice { margin: 16px 0; }
.near-day { margin-left: 8px; }
.measured-breach ul { margin: 4px 0 0; padding-left: 18px; }
.small { font-size: 12px; }
@media (max-width: 1000px) { .day-grid { grid-template-columns: 1fr; } }
</style>
