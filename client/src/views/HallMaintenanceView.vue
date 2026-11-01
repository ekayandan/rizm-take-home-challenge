<script setup lang="ts">
/**
 * Hall maintenance view: the hall's windows (form to add one, list of all) and what they do to
 * the stored plan on one day, charted against that plan. A preview takes over from the saved
 * windows until it is withdrawn, and opens on the day its window starts.
 * URL: /halls/:hallId/maintenance?date=YYYY-MM-DD&schedule=baseline|optimized
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, type Consequences, type HallDetail, type HallSeries, type ProposedWindow } from "../api";
import { comparisonPanels } from "../comparison";
import ConsequencesSummary from "../components/ConsequencesSummary.vue";
import DayChart from "../components/DayChart.vue";
import DayPicker from "../components/DayPicker.vue";
import HallTabs from "../components/HallTabs.vue";
import MaintenancePanel from "../components/MaintenancePanel.vue";

const props = defineProps<{ hallId: string }>();
const route = useRoute();
const router = useRouter();

const hall = ref<HallDetail | null>(null);
const series = ref<HallSeries | null>(null);
const inForce = ref<Consequences | null>(null);
const preview = ref<Consequences | null>(null);
const proposed = ref<ProposedWindow | null>(null);
const previewLoading = ref(false);
const error = ref<string | null>(null);
const notFound = ref(false);

/** ?date= if the hall has data for it, else its first day with data. */
const date = computed(() => {
  const days = hall.value?.days ?? [];
  const q = route.query.date;
  return typeof q === "string" && days.some((d) => d.date === q) ? q : days[0]?.date ?? "";
});
const schedule = computed(() => {
  const names = hall.value?.schedules ?? [];
  const q = route.query.schedule;
  if (typeof q === "string" && names.includes(q)) return q;
  return names.includes("optimized") ? "optimized" : names[0] ?? "";
});
const goToDay = (d: string) => router.replace({ query: { ...route.query, date: d } });

let hallRequest = 0;
async function loadHall() {
  const req = ++hallRequest;
  hall.value = null;
  notFound.value = false;
  error.value = null;
  try {
    const h = await api.hall(props.hallId);
    if (req === hallRequest) hall.value = h;
  } catch (e) {
    if (req !== hallRequest) return;
    if (e instanceof ApiError && e.status === 404) notFound.value = true;
    else error.value = (e as Error).message;
  }
}

let dayRequest = 0;
async function loadDay() {
  const req = ++dayRequest;
  series.value = null;
  inForce.value = null;
  if (!date.value || !schedule.value) return;
  error.value = null;
  try {
    const [s, r] = await Promise.all([
      api.series(props.hallId, date.value),
      api.consequences(props.hallId, date.value, schedule.value),
    ]);
    if (req !== dayRequest) return;
    series.value = s;
    inForce.value = r;
  } catch (e) {
    if (req === dayRequest) error.value = (e as Error).message;
  }
}

let previewRequest = 0;
async function loadPreview() {
  const req = ++previewRequest;
  preview.value = null;
  if (!proposed.value || !date.value) return;
  previewLoading.value = true;
  error.value = null;
  try {
    const r = await api.consequences(props.hallId, date.value, schedule.value, proposed.value);
    if (req === previewRequest) preview.value = r;
  } catch (e) {
    if (req === previewRequest) error.value = (e as Error).message;
  } finally {
    if (req === previewRequest) previewLoading.value = false;
  }
}

/** A window outside the data period has no day of its own to open on, so the day stays. */
function runPreview(w: ProposedWindow) {
  proposed.value = w;
  const start = w.start.slice(0, 10);
  if (start !== date.value && hall.value?.days.some((d) => d.date === start)) goToDay(start);
  else loadPreview();
}

function clearPreview() {
  previewRequest++;
  proposed.value = null;
  preview.value = null;
  previewLoading.value = false;
}

function onSaved() {
  clearPreview();
  loadDay();
}

watch(() => props.hallId, () => { clearPreview(); loadHall(); }, { immediate: true });
watch([hall, date, schedule], () => { loadDay(); loadPreview(); }, { immediate: true });

const report = computed(() => preview.value ?? inForce.value);
const panels = computed(() => (series.value && report.value?.plan_changed ? comparisonPanels(series.value, report.value) : []));
const times = computed(() => (series.value ? [...series.value.local_time.map((t) => t.slice(11, 16)), "24:00"] : []));
</script>

<template>
  <template v-if="notFound">
    <p class="error">We couldn't find that hall.</p>
    <RouterLink to="/">Back to Sites</RouterLink>
  </template>
  <template v-else>
    <nav class="crumbs">
      <RouterLink to="/">Sites</RouterLink> ›
      <RouterLink :to="{ name: 'hall', params: { hallId } }">{{ hall?.name ?? hallId }}</RouterLink> ›
      <span>Maintenance</span>
    </nav>
    <h1>{{ hall?.name ?? hallId }} <span class="muted">· Maintenance</span></h1>
    <HallTabs v-if="date" :hall-id="hallId" :date="date" />

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="hall && !hall.days.length" class="muted">No data has been recorded for this hall yet, so consequences can't be calculated.</p>

    <MaintenancePanel
      v-if="hall"
      :hall-id="hallId"
      :date="date"
      :timezone="hall.timezone"
      @preview="runPreview"
      @preview-clear="clearPreview"
      @saved="onSaved"
    >
      <template #preview>
        <p v-if="previewLoading" class="muted small" role="status">Simulating…</p>
        <div v-else-if="report && (preview || report.windows.length)" class="result" aria-label="Consequences">
          <ConsequencesSummary :report="report" :title="preview ? 'Preview, not saved' : 'Saved maintenance'" />
          <template v-if="panels.length">
            <div class="day-nav">
              <span class="muted small">Plan against maintenance on</span>
              <DayPicker v-if="hall?.days.length" :model-value="date" :days="hall.days" @update:model-value="goToDay" />
            </div>
            <DayChart :times="times" :panels="panels" />
          </template>
        </div>
      </template>
    </MaintenancePanel>
  </template>
</template>

<style scoped>
.crumbs { font-size: 13px; color: #6a737d; }
.crumbs a { color: inherit; }
h1 { margin: 6px 0 12px; }
.result { margin: 12px 0; padding: 12px; border: 1px solid #eef0f3; border-radius: 6px; min-width: 0; }
.day-nav { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; }
.small { font-size: 12px; }
</style>
