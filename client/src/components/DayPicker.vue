<script setup lang="ts">
/**
 * Month calendar for picking one of a hall's days. Every day with data shows its step count;
 * days without data cannot be picked.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { NORMAL_DAY_STEPS } from "../api";

const props = defineProps<{ modelValue: string; days: { date: string; steps: number }[] }>();
const emit = defineEmits<{ "update:modelValue": [date: string] }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const month = ref(""); // YYYY-MM on display
const focused = ref(""); // the one day reachable with Tab

const stepsByDate = computed(() => new Map(props.days.map((d) => [d.date, d.steps])));
const selectedSteps = computed(() => stepsByDate.value.get(props.modelValue));
const firstMonth = computed(() => props.days[0]?.date.slice(0, 7) ?? "");
const lastMonth = computed(() => props.days.at(-1)?.date.slice(0, 7) ?? "");

const monthParts = computed(() => month.value.split("-").map(Number));
const monthLabel = computed(() => {
  const [y, m] = monthParts.value;
  return new Date(Date.UTC(y, m - 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
});

/** Blank cells up to the month's first weekday (weeks start on Monday), then its dates. */
const cells = computed(() => {
  const [y, m] = monthParts.value;
  if (!y) return [];
  const blanks = (new Date(Date.UTC(y, m - 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length }, (_, i) => `${month.value}-${String(i + 1).padStart(2, "0")}`),
  ];
});

const shiftMonth = (by: number) => {
  const [y, m] = monthParts.value;
  month.value = new Date(Date.UTC(y, m - 1 + by)).toISOString().slice(0, 7);
  // Keep a day in the new month reachable with Tab.
  focused.value = props.days.find((d) => d.date.startsWith(month.value))?.date ?? focused.value;
};

const isUnusual = (date: string) => {
  const steps = stepsByDate.value.get(date);
  return steps !== undefined && steps !== NORMAL_DAY_STEPS;
};

const dayLabel = (date: string) => {
  const steps = stepsByDate.value.get(date);
  return steps === undefined ? `${date}, no data` : `${date}, ${steps} steps`;
};

async function focusDay(date: string) {
  focused.value = date;
  month.value = date.slice(0, 7);
  await nextTick();
  root.value?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
}

function toggle() {
  if (open.value) return close();
  open.value = true;
  const start = stepsByDate.value.has(props.modelValue) ? props.modelValue : props.days.at(-1)?.date;
  if (start) void focusDay(start);
}

function close(returnFocus = false) {
  open.value = false;
  if (returnFocus) root.value?.querySelector<HTMLElement>(".day-picker-toggle")?.focus();
}

function pick(date: string) {
  if (!stepsByDate.value.has(date)) return;
  emit("update:modelValue", date);
  close(true);
}

/** Date `by` days away from `date`. */
const addDays = (date: string, by: number) => new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") {
    close(true);
    return;
  }
  const at = props.days.findIndex((d) => d.date === focused.value);
  if (at < 0) return;
  // Left/right walk the days with data; up/down keep the weekday and stay put on a gap.
  const target =
    e.key === "ArrowLeft" ? props.days[at - 1]?.date
    : e.key === "ArrowRight" ? props.days[at + 1]?.date
    : e.key === "ArrowUp" ? addDays(focused.value, -7)
    : e.key === "ArrowDown" ? addDays(focused.value, 7)
    : undefined;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  if (target && stepsByDate.value.has(target)) void focusDay(target);
}

const onOutside = (e: PointerEvent) => {
  if (open.value && !root.value?.contains(e.target as Node)) close();
};
onMounted(() => document.addEventListener("pointerdown", onOutside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutside));
</script>

<template>
  <div ref="root" class="day-picker" @keydown="onKeydown">
    <button type="button" class="day-picker-toggle" :disabled="!days.length" aria-haspopup="dialog" :aria-expanded="open" :aria-label="modelValue ? `Day: ${dayLabel(modelValue)}` : 'Day'" :title="modelValue ? dayLabel(modelValue) : undefined" @click="toggle()">
      {{ modelValue || (days.length ? "Pick a day" : "No days with data") }}
      <span v-if="modelValue" class="muted count"><template v-if="selectedSteps === undefined">no data</template><template v-else><svg class="step-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0M14.500 10.500l-2.500 2.500M17 8l1 -1M14 3h-4" /></svg>{{ selectedSteps }}</template></span>
    </button>

    <div v-if="open" class="day-picker-popup" role="dialog" aria-label="Choose a day">
      <div class="day-picker-head">
        <button type="button" aria-label="Previous month" :disabled="month <= firstMonth" @click="shiftMonth(-1)">‹</button>
        <strong aria-live="polite">{{ monthLabel }}</strong>
        <button type="button" aria-label="Next month" :disabled="month >= lastMonth" @click="shiftMonth(1)">›</button>
      </div>
      <div class="day-picker-grid">
        <span v-for="w in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']" :key="w" class="muted weekday" aria-hidden="true">{{ w }}</span>
        <template v-for="(d, i) in cells" :key="d ?? `blank-${i}`">
          <span v-if="!d" />
          <button
            v-else
            type="button"
            class="day"
            :class="{ selected: d === modelValue, unusual: isUnusual(d) }"
            :data-date="d"
            :disabled="!stepsByDate.has(d)"
            :tabindex="d === focused ? 0 : -1"
            :aria-label="dayLabel(d)"
            :title="dayLabel(d)"
            :aria-current="d === modelValue ? 'date' : undefined"
            @click="pick(d)"
          >
            <span>{{ Number(d.slice(8)) }}</span>
            <small class="count"><template v-if="stepsByDate.has(d)"><svg class="step-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0M14.500 10.500l-2.500 2.500M17 8l1 -1M14 3h-4" /></svg>{{ stepsByDate.get(d) }}</template><template v-else>–</template></small>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.day-picker { position: relative; display: inline-block; }
.day-picker-toggle { display: inline-flex; align-items: center; gap: 6px; font: inherit; padding: 4px 8px; cursor: pointer; }
.day-picker-popup { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; width: 322px; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 12px; background: #fff; border: 1px solid #dde1e6; border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / .15); }
.day-picker-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.day-picker-head button { font: inherit; padding: 2px 10px; cursor: pointer; }
.day-picker-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.weekday { text-align: center; font-size: 12px; padding-bottom: 2px; }
.day { display: flex; flex-direction: column; align-items: center; padding: 3px 0; font: inherit; line-height: 1.2; color: inherit; background: #f5f6f8; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-variant-numeric: tabular-nums; }
.day small { font-size: 11px; color: #6a737d; }
.day:hover:not(:disabled) { border-color: #6a737d; }
.day:disabled { background: none; color: #a8b0b8; cursor: default; }
.day:disabled small { color: inherit; }
.day.selected { background: var(--accent); color: #fff; }
.day.selected small { color: #e8eaed; }
.day small { white-space: nowrap; }
.count { display: inline-flex; align-items: center; gap: 2px; }
.step-icon { width: 1.1em; height: 1.1em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.day.unusual { background: #d6e8ff; }
.day.unusual small { color: var(--accent); font-weight: 700; }
.day.unusual.selected { background: var(--accent); }
.day.unusual.selected small { color: #d6e8ff; }
</style>
