<script setup lang="ts">
/**
 * Hall week view: seven local days from :date, on the same chart and endpoints as the day
 * view. The cost endpoint is per day, so its traces are stitched together here.
 * URL: /halls/:hallId/weeks/:date?schedule=baseline|optimized
 */
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, type DayCostTraced, type HallDetail, type HallSeries, type MeasuredViolation } from "../api";
import HallTabs from "../components/HallTabs.vue";
import DayChart, { type ChartDay, type ChartPanel, type ChartViolation } from "../components/DayChart.vue";
import { perfLog, timed } from "../perf";

const WEEK_DAYS = 7;

const props = defineProps<{ hallId: string; date: string }>();
const route = useRoute();

const hall = ref<HallDetail | null>(null);
const series = ref<HallSeries | null>(null);
const dayCosts = ref<DayCostTraced[]>([]);
const breaches = ref<MeasuredViolation[]>([]);
const error = ref<string | null>(null);

const schedule = computed(() => {
  const q = route.query.schedule;
  return typeof q === "string" ? q : "optimized";
});

const weekDates = computed(() => {
  const days = hall.value?.days ?? [];
  const i = days.findIndex((d) => d.date === props.date);
  return i < 0 ? [] : days.slice(i, i + WEEK_DAYS).map((d) => d.date);
});

let request = 0;
watch(
  () => props.hallId,
  async (id) => {
    hall.value = null;
    error.value = null;
    try {
      hall.value = await api.hall(id);
    } catch (e) {
      error.value = (e as Error).message;
    }
  },
  { immediate: true },
);

watch(
  [weekDates, schedule],
  async ([dates, name]) => {
    const req = ++request;
    series.value = null;
    // Keep a failed hall request's error; nothing else can be showing without a hall.
    if (hall.value) error.value = null;
    if (!dates.length) return;
    const start = performance.now();
    try {
      const from = dates[0], to = dates.at(-1)!;
      const [s, v, ...costs] = await Promise.all([
        api.seriesRange(props.hallId, from, to),
        api.violationsRange(props.hallId, from, to),
        ...dates.map((d) => api.scheduleDayCost(props.hallId, d, name)),
      ]);
      if (req !== request) return;
      perfLog("week data loaded", performance.now() - start, `${2 + dates.length} requests`);
      breaches.value = v.violations;
      dayCosts.value = costs;
      series.value = s;
    } catch (e) {
      if (req === request) error.value = (e as Error).message;
    }
  },
  { immediate: true },
);

/** Days share their boundary state point, so later days drop their first one. */
const stitch = (pick: (c: DayCostTraced) => number[]) =>
  dayCosts.value.flatMap((c, i) => (i === 0 ? pick(c) : pick(c).slice(1)));

const STATE_TEMP = new Set(["temp_below_min", "temp_above_max"]);
function panelViolations(pred: (c: string) => boolean): ChartViolation[] {
  const start = series.value?.step_start ?? 0;
  return [
    ...breaches.value
      .filter((v) => pred(v.constraint))
      .map((v) => ({ index: v.step - start, line: 0, note: `Measured ${v.constraint}` })),
    ...dayCosts.value.flatMap((c) => c.violations)
      .filter((v) => pred(v.constraint))
      .map((v) => ({ index: v.step - start, line: 1, note: `Simulated ${v.constraint}` })),
  ];
}

const times = computed(() => {
  const s = series.value;
  return s ? [...s.local_time.map((x) => x.slice(11, 16)), "24:00"] : [];
});

/** Where each local day starts; clock-change days have 92 or 100 steps. */
const days = computed<ChartDay[]>(() => {
  const out: ChartDay[] = [];
  series.value?.local_time.forEach((t, start) => {
    const date = t.slice(0, 10);
    if (out.at(-1)?.date !== date) out.push({ start, date });
  });
  return out;
});

const noData = computed(() => hall.value !== null && !weekDates.value.length);

const panels = computed<ChartPanel[]>(() => {
  const s = series.value;
  const sc = s?.schedules[schedule.value];
  if (!s || !sc) return [];
  return timed("week panels built", () => [
    {
      id: "price", title: "Spot price", unit: "€/MWh", height: 90,
      lines: [{ label: "Price", color: "#495057", values: s.series.price_eur_per_mwh, kind: "step", digits: 2 }],
      include: [0],
    },
    {
      id: "flow", title: "Fan mass flow", unit: "kg/s", height: 80,
      lines: [{ label: "Mass flow", color: "#5f3dc4", values: sc.mass_flow_kg_per_s, kind: "step", area: true, digits: 2 }],
      include: [0],
    },
    {
      id: "recirc", title: "Recirculation", unit: "share of supply air", height: 70,
      lines: [{ label: "Recirculation", color: "#0c8599", values: sc.recirculation, kind: "step", area: true, digits: 2 }],
      include: [0, 1],
    },
    {
      id: "power", title: "Heating and cooling", unit: "kW thermal", height: 100,
      lines: [
        { label: "Heating", color: "#d9480f", values: sc.heating_kw, kind: "step", area: true },
        { label: "Cooling", color: "#1c7ed6", values: sc.cooling_kw, kind: "step", area: true },
      ],
      include: [0],
    },
    {
      id: "temp", title: "Indoor temperature", unit: "°C", height: 130,
      lines: [
        { label: "Measured", color: "#c2255c", values: s.measured.temperature_c, kind: "state" },
        { label: "Simulated", color: "#c2255c", values: stitch((c) => c.trace.temperature_c), kind: "state", dashed: true },
      ],
      bands: [{ label: "Allowed", lower: s.bounds.temp_min_c, upper: s.bounds.temp_max_c }],
      violations: panelViolations((c) => STATE_TEMP.has(c)),
    },
    {
      id: "co2", title: "Indoor CO₂", unit: "ppm", height: 110,
      lines: [
        { label: "Measured", color: "#2b8a3e", values: s.measured.co2_ppm, kind: "state", digits: 0 },
        { label: "Simulated", color: "#2b8a3e", values: stitch((c) => c.trace.co2_ppm), kind: "state", digits: 0, dashed: true },
      ],
      bands: [{ label: "Allowed", upper: s.bounds.co2_max_ppm }],
      violations: panelViolations((c) => c === "co2_above_max"),
    },
  ]);
});
</script>

<template>
  <nav class="crumbs">
    <RouterLink to="/">Sites</RouterLink> ›
    <RouterLink :to="{ name: 'hall-day', params: { hallId, date }, query: route.query }">{{ date }}</RouterLink> ›
    <span>Week</span>
  </nav>
  <h1>{{ hall?.name ?? hallId }} <span v-if="weekDates.length" class="muted">· {{ weekDates[0] }} – {{ weekDates.at(-1) }}</span></h1>
  <HallTabs :hall-id="hallId" :date="date" />

  <p v-if="error" class="error">{{ error }}</p>
  <div v-else class="week-grid">
    <section class="card">
      <p v-if="noData" class="muted">No data for this date.</p>
      <p v-else-if="!series" class="muted">Loading week…</p>
      <DayChart v-else :times="times" :panels="panels" :days="days" />
    </section>
  </div>
</template>

<style scoped>
.crumbs { font-size: 13px; color: #6a737d; }
.crumbs a { color: inherit; }
h1 { margin: 6px 0 12px; }
.week-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
.card { min-width: 0; }
</style>
