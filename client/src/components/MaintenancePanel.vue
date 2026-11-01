<script setup lang="ts">
/**
 * Maintenance windows of one hall: a form to record that an asset (fan, boiler, chiller) is
 * unavailable between two local times, and the list of all of the hall's windows. Windows that
 * touch the shown day are highlighted. Times are wall-clock times in the hall's timezone.
 */
import { computed, reactive, ref, watch } from "vue";
import { api, ASSETS, type Asset, type MaintenanceWindow } from "../api";
import { useAuthStore } from "../stores/auth";
import TermHelp from "./TermHelp.vue";

const props = defineProps<{ hallId: string; date: string; timezone: string }>();
const auth = useAuthStore();

const ASSET_LABELS: Record<Asset, string> = { fan: "Fan", boiler: "Boiler", chiller: "Chiller" };

const windows = ref<MaintenanceWindow[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

const canEdit = computed(() => auth.user?.role === "admin" || auth.user?.role === "operator");

const form = reactive({ asset: "fan" as Asset, start: "", end: "", reason: "" });
const saving = ref(false);
const submitError = ref<string | null>(null);
const saved = ref<number | null>(null);

function resetTimes() {
  form.start = `${props.date}T06:00`;
  form.end = `${props.date}T14:00`;
}

let request = 0;
async function load() {
  const req = ++request;
  loading.value = true;
  loadError.value = null;
  try {
    const list = await api.maintenance(props.hallId);
    if (req === request) windows.value = list;
  } catch (e) {
    if (req === request) loadError.value = (e as Error).message;
  } finally {
    if (req === request) loading.value = false;
  }
}

watch(() => props.hallId, () => { windows.value = []; load(); }, { immediate: true });
watch(() => props.date, () => { resetTimes(); submitError.value = null; saved.value = null; }, { immediate: true });

/** Both fields hold "YYYY-MM-DDTHH:MM" in the same timezone, so text order is time order. */
const rangeError = computed(() => (form.start && form.end && form.end <= form.start ? "End must be after start." : null));
const canSubmit = computed(() => !!form.start && !!form.end && !!form.reason.trim() && !rangeError.value && !saving.value);

async function submit() {
  submitError.value = null;
  saved.value = null;
  if (!canSubmit.value) return;
  saving.value = true;
  try {
    const w = await api.addMaintenance(props.hallId, { asset: form.asset, start: form.start, end: form.end, reason: form.reason });
    saved.value = w.id;
    form.reason = "";
    await load();
  } catch (e) {
    submitError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

/** "2026-10-06T08:00+02:00" -> "2026-10-06 08:00" */
const fmt = (local: string) => `${local.slice(0, 10)} ${local.slice(11, 16)}`;
const offset = (local: string) => local.slice(16);

function duration(w: MaintenanceWindow): string {
  const min = Math.round((Date.parse(w.end_utc) - Date.parse(w.start_utc)) / 60000);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

/** True if the window overlaps the shown local day. */
const onShownDay = (w: MaintenanceWindow) =>
  w.start_local.slice(0, 10) <= props.date && fmt(w.end_local) > `${props.date} 00:00`;
</script>

<template>
  <section class="card maintenance" aria-labelledby="maintenance-title">
    <h2 id="maintenance-title">Maintenance windows<TermHelp term="maintenanceWindow" /></h2>
    <p class="muted small">Times are local to the hall ({{ timezone }}).</p>

    <form v-if="canEdit" class="mw-form" novalidate @submit.prevent="submit">
      <label>
        Asset
        <select v-model="form.asset" name="asset">
          <option v-for="a in ASSETS" :key="a" :value="a">{{ ASSET_LABELS[a] }}</option>
        </select>
      </label>
      <label>
        Start
        <input v-model="form.start" type="datetime-local" name="start" required :aria-invalid="!!rangeError" />
      </label>
      <label>
        End
        <input v-model="form.end" type="datetime-local" name="end" required :aria-invalid="!!rangeError" />
      </label>
      <label class="reason">
        Reason
        <input v-model="form.reason" type="text" name="reason" required maxlength="500" placeholder="Why is this needed?" />
      </label>
      <button type="submit" class="primary" :disabled="!canSubmit">{{ saving ? "Saving…" : "Add window" }}</button>
    </form>
    <p v-else class="muted small">Only operators and admins can add maintenance windows.</p>
    <p v-if="canEdit && rangeError" class="error small" role="alert">{{ rangeError }}</p>
    <p v-if="submitError" class="error small" role="alert">{{ submitError }}</p>

    <p v-if="loadError" class="error">{{ loadError }}</p>
    <p v-else-if="loading && !windows.length" class="muted">Loading windows…</p>
    <p v-else-if="!windows.length" class="muted">No maintenance windows recorded for this hall.</p>
    <table v-else>
      <thead>
        <tr><th>Asset</th><th>Start</th><th>End</th><th>Duration</th><th>Reason</th><th>Added by</th></tr>
      </thead>
      <tbody>
        <tr v-for="w in windows" :key="w.id" :class="{ today: onShownDay(w), fresh: w.id === saved }">
          <td>{{ ASSET_LABELS[w.asset] ?? w.asset }}</td>
          <td>{{ fmt(w.start_local) }} <span class="muted small">{{ offset(w.start_local) }}</span></td>
          <td>{{ fmt(w.end_local) }} <span class="muted small">{{ offset(w.end_local) }}</span></td>
          <td>{{ duration(w) }}</td>
          <td>{{ w.reason }}</td>
          <td class="muted">{{ w.created_by_name }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="windows.some(onShownDay)" class="muted small">Highlighted windows overlap {{ date }}.</p>
  </section>
</template>

<style scoped>
.maintenance h2 { margin: 0 0 4px; font-size: 15px; }
.mw-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin: 12px 0 8px; }
.mw-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #4a535c; }
.mw-form select, .mw-form input { margin: 0; font: inherit; padding: 4px 6px; border: 1px solid #c9ced4; border-radius: 6px; background: #fff; }
.mw-form input[aria-invalid="true"] { border-color: #b42318; }
.mw-form .reason { flex: 1 1 220px; }
button.primary { font: inherit; padding: 5px 14px; border: 1px solid #1d232a; background: #1d232a; color: #fff; border-radius: 6px; cursor: pointer; }
button.primary:disabled { opacity: 0.4; cursor: default; }
table { margin-top: 12px; }
tr.today td { background: #fff8e1; }
tr.fresh td:first-child { font-weight: 600; }
.small { font-size: 12px; }
.error.small { margin: 4px 0; }
</style>
