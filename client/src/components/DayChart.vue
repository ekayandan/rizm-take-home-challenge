<script setup lang="ts">
/**
 * Stacked time-series panels sharing one x axis (one local day). The x axis is the step
 * index, so DST days with 92 or 100 steps need no special handling; tick labels come from
 * the local wall-clock times.
 *
 * - "step" lines have N values: value k holds over step k (from state point k to k+1).
 * - "state" lines and bounds have N+1 values, one per state point.
 */
import { computed, onBeforeMount, onBeforeUnmount, onBeforeUpdate, onMounted, onUpdated, ref } from "vue";
import { perfLog, timed } from "../perf";

export interface ChartLine {
  label: string;
  color: string;
  values: (number | null)[];
  kind: "step" | "state";
  dashed?: boolean;
  /** Fill the area between the line and zero. */
  area?: boolean;
  digits?: number;
}
export interface ChartBand {
  label: string;
  /** N+1 values; omitted = bottom of the panel. */
  lower?: number[];
  /** N+1 values; omitted = top of the panel. */
  upper?: number[];
}
/** A broken limit at a state point. */
export interface ChartViolation {
  /** State point index. */
  index: number;
  /** Index into the panel's lines of the line that broke the limit. */
  line: number;
  /** Shown while hovering, e.g. "Measured 1,20 °C above limit". */
  note: string;
}
export interface ChartPanel {
  id: string;
  title: string;
  unit: string;
  height: number;
  lines: ChartLine[];
  bands?: ChartBand[];
  /** Force the y range to include these values (e.g. 0). */
  include?: number[];
  /** Marked with a dot on the line and a shaded interval leading up to the state point. */
  violations?: ChartViolation[];
}
/** A local day on a multi-day chart. */
export interface ChartDay {
  /** Step index of the day's first step. */
  start: number;
  /** Local date, YYYY-MM-DD. */
  date: string;
}

const props = defineProps<{
  /** N+1 local times HH:MM, one per state point. */
  times: string[];
  panels: ChartPanel[];
  /** Multi-day charts: the first step of each local day, in order. Replaces the HH:MM axis labels. */
  days?: ChartDay[];
}>();

const M = { left: 56, right: 14, top: 22, bottom: 6 };
const AXIS_H = 24;
const GAP = 10;

const root = ref<HTMLDivElement | null>(null);
const width = ref(800);
let ro: ResizeObserver | undefined;
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(320, Math.floor(e.contentRect.width))));
  if (root.value) ro.observe(root.value);
});
onBeforeUnmount(() => ro?.disconnect());

const n = computed(() => Math.max(1, props.times.length - 1));
const plotW = computed(() => width.value - M.left - M.right);
const x = (i: number) => M.left + (i / n.value) * plotW.value;

function niceTicks(lo: number, hi: number, count = 4): number[] {
  // Halved so the span of extreme values stays finite.
  const raw = (((hi / 2 - lo / 2) / count) * 2) || 1 / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw && Number.isFinite(s)) ?? raw;
  const first = Math.ceil(lo / step);
  const out: number[] = [];
  // Counted, not summed: adding the step to a huge value may not change it.
  for (let k = 0; k <= count + 1; k++) {
    const v = (first + k) * step;
    if (!(v <= hi + 1e-9)) break;
    out.push(+v.toFixed(10));
  }
  return out;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

const clampFinite = (v: number) => Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, v));

/** Smallest and largest finite value; a loop because series can be too long to spread. */
function extent(lists: readonly (readonly (number | null)[])[]): { lo: number; hi: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (const list of lists) {
    for (const v of list) {
      if (!finite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/** On narrow charts (the 1024 px tablet) the legend gets its own row under the title. */
const LEGEND_ROW = 15;
const stackedHeader = computed(() => width.value < 720);

const layout = computed(() => timed("chart layout", () => {
  let top = 0;
  return props.panels.map((p) => {
    const range = extent([
      ...p.lines.map((l) => l.values),
      ...(p.bands ?? []).flatMap((b) => [b.lower ?? [], b.upper ?? []]),
      p.include ?? [],
    ]);
    let lo = range ? range.lo : 0;
    let hi = range ? range.hi : 1;
    // Flat, relative to the size of the values: large numbers cannot resolve a smaller gap.
    const size = Math.max(Math.abs(lo), Math.abs(hi));
    if (hi - lo < Math.max(1e-9, size * 1e-12)) {
      const widen = Math.max(1, size * 1e-12);
      lo = clampFinite(lo - widen);
      hi = clampFinite(hi + widen);
    }
    const pad = (hi / 2 - lo / 2) * 0.12;
    const ticks = niceTicks(clampFinite(lo - (lo === 0 ? 0 : pad)), clampFinite(hi + pad), p.height >= 100 ? 5 : 3);
    const y0 = Math.min(ticks[0] ?? lo, lo), y1 = Math.max(ticks.at(-1) ?? hi, hi);
    const header = M.top + (stackedHeader.value ? LEGEND_ROW : 0);
    const t = top + header, h = p.height;
    const y = (v: number) => t + h - ((v / 2 - y0 / 2) / (y1 / 2 - y0 / 2 || 1)) * h;
    top += header + h + M.bottom + GAP;
    return { p, top: t, h, y, y0, y1, ticks };
  });
}));

// Render plus DOM patch, the hover latency and the first paint of the chart.
let renderStart = 0;
let hoverStart = 0;
const logRender = (label: string) => {
  const nodes = root.value?.querySelectorAll("svg *").length ?? 0;
  perfLog(label, performance.now() - renderStart, `${n.value} steps, ${nodes} svg nodes`);
};
onBeforeMount(() => (renderStart = performance.now()));
onBeforeUpdate(() => (renderStart = performance.now()));
onMounted(() => {
  logRender("chart mount");
  requestAnimationFrame(() => setTimeout(() => perfLog("chart first paint", performance.now() - renderStart)));
});
onUpdated(() => {
  logRender("chart update");
  if (hoverStart) perfLog("hover to update", performance.now() - hoverStart);
  hoverStart = 0;
});

const height = computed(() => {
  const last = layout.value.at(-1);
  return (last ? last.top + last.h + M.bottom : 0) + AXIS_H;
});

/** Path of a line; null values break it. */
function linePath(l: ChartLine, y: (v: number) => number): string {
  let d = "";
  let open = false;
  l.values.forEach((v, i) => {
    if (!finite(v)) { open = false; return; }
    if (l.kind === "step") {
      d += open ? ` V${y(v).toFixed(1)} H${x(i + 1).toFixed(1)}` : ` M${x(i).toFixed(1)},${y(v).toFixed(1)} H${x(i + 1).toFixed(1)}`;
    } else {
      d += `${open ? " L" : " M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    }
    open = true;
  });
  return d.trim();
}

function areaPath(l: ChartLine, y: (v: number) => number): string {
  if (l.kind !== "step") return "";
  const base = y(0).toFixed(1);
  let d = "";
  let open = false;
  l.values.forEach((v, i) => {
    if (!finite(v)) {
      if (open) d += ` V${base} Z`;
      open = false;
      return;
    }
    if (!open) d += ` M${x(i).toFixed(1)},${base}`;
    d += ` V${y(v).toFixed(1)} H${x(i + 1).toFixed(1)}`;
    open = true;
  });
  if (open) d += ` V${base} Z`;
  return d.trim();
}

/** Stepped band polygon between lower and upper (bounds change at state points). */
function bandPath(b: ChartBand, l: (typeof layout.value)[number]): string {
  const N = n.value;
  const lo = (i: number) => l.y(b.lower ? b.lower[i] : l.y0);
  const hi = (i: number) => l.y(b.upper ? b.upper[i] : l.y1);
  let d = `M${x(0)},${hi(0)}`;
  for (let i = 1; i <= N; i++) d += ` H${x(i)} V${hi(i)}`;
  d += ` V${lo(N)}`;
  for (let i = N; i >= 1; i--) d += ` H${x(i)} V${lo(i - 1)}`;
  return d + ` H${x(0)} Z`;
}

function boundPath(vals: number[], y: (v: number) => number): string {
  let d = `M${x(0)},${y(vals[0])}`;
  for (let i = 1; i < vals.length; i++) d += ` H${x(i)} V${y(vals[i])}`;
  return d;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const weekday = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
};
/** "Mo 12.10." */
const dayLabel = (date: string) => `${weekday(date)} ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
/** "Mo 12", which fits one day of seven at the narrowest chart. */
const shortDayLabel = (date: string) => `${weekday(date)} ${date.slice(8, 10)}`;

/** Upper estimate of a tick character's width (11 px font), plus the gap kept between labels. */
const TICK_CHAR_W = 7;
const TICK_GAP = 4;

/** One label per day, centred on the day; `i` is the grid line, `at` the label position. */
function dayTicks(days: ChartDay[]) {
  const ticks = days.map((d, k) => ({ i: d.start, at: (d.start + (days[k + 1]?.start ?? n.value)) / 2, date: d.date }));
  const room = Math.min(...ticks.slice(1).map((t, k) => ((t.at - ticks[k].at) / n.value) * plotW.value));
  const full = ticks.every((t) => dayLabel(t.date).length * TICK_CHAR_W + TICK_GAP <= room);
  return ticks.map((t) => ({ t: full ? dayLabel(t.date) : shortDayLabel(t.date), i: t.i, at: t.at }));
}

const xTicks = computed(() => {
  if (props.days?.length) return dayTicks(props.days);
  const every = width.value < 560 ? 6 : 3;
  return props.times
    .map((t, i) => ({ t, i, at: i }))
    .filter(({ t, i }) => t.endsWith(":00") && (+t.slice(0, 2) % every === 0) && i < props.times.length - 1);
});

// --- hover ---
const hover = ref<number | null>(null);
function onMove(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  hoverStart = performance.now();
  const px = e.clientX - svg.getBoundingClientRect().left;
  if (px < M.left || px > width.value - M.right) { hover.value = null; return; }
  hover.value = Math.min(n.value - 1, Math.max(0, Math.floor(((px - M.left) / plotW.value) * n.value)));
}

/** The day of the hovered step; only looks at the day list, not the series. */
const hoverDay = computed(() => {
  const h = hover.value;
  const days = props.days;
  if (h === null || !days?.length) return "";
  let day = days[0];
  for (const d of days) if (d.start <= h) day = d;
  return `${dayLabel(day.date)} `;
});

/** Hovering a step shows the state at its end, so that is the violation to explain. */
const hoverNotes = computed(() => {
  const h = hover.value;
  if (h === null) return [];
  return props.panels.flatMap((p) => (p.violations ?? []).filter((v) => v.index === h + 1).map((v) => `${p.title}: ${v.note}`));
});

/** Intervals to shade: the step in which the state reached the violating point. */
function violationSteps(p: ChartPanel): number[] {
  return [...new Set((p.violations ?? []).map((v) => v.index - 1).filter((i) => i >= 0))];
}

function valueAt(l: ChartLine, i: number): string {
  const v = l.values[i];
  if (!finite(v)) return "–";
  return v.toLocaleString("de-DE", { minimumFractionDigits: l.digits ?? 1, maximumFractionDigits: l.digits ?? 1 });
}
</script>

<template>
  <div ref="root" class="day-chart">
    <div class="readout" aria-live="polite">
      <template v-if="hover !== null">
        {{ hoverDay }}{{ times[hover] }}–{{ times[hover + 1] }}
        <span v-for="note in hoverNotes" :key="note" class="note">· {{ note }}</span>
      </template>
      <span v-else class="muted">Hover the chart for values</span>
    </div>
    <svg
      :width="width"
      :height="height"
      role="img"
      aria-label="Spot price, controls and indoor climate over the day"
      @pointermove="onMove"
      @pointerleave="hover = null"
    >
      <!-- Everything but the legend and highlight: skipped on hover, so hovering stays cheap. -->
      <g v-for="l in layout" :key="l.p.id" v-memo="[l, width, xTicks]">
        <text :x="M.left" :y="l.top - 8 - (stackedHeader ? LEGEND_ROW : 0)" class="title">{{ l.p.title }} <tspan class="unit">({{ l.p.unit }})</tspan></text>
        <rect :x="M.left" :y="l.top" :width="plotW" :height="l.h" class="plot-bg" />
        <path v-for="b in l.p.bands ?? []" :key="b.label" :d="bandPath(b, l)" class="band" />
        <template v-for="b in l.p.bands ?? []" :key="b.label + '-lines'">
          <path v-if="b.lower" :d="boundPath(b.lower, l.y)" class="bound" />
          <path v-if="b.upper" :d="boundPath(b.upper, l.y)" class="bound" />
        </template>

        <rect
          v-for="i in violationSteps(l.p)"
          :key="'vs' + i"
          :x="x(i)"
          :y="l.top"
          :width="x(i + 1) - x(i)"
          :height="l.h"
          class="violation-span"
        />

        <g class="grid">
          <line v-for="t in l.ticks" :key="t" :x1="M.left" :x2="width - M.right" :y1="l.y(t)" :y2="l.y(t)" />
          <line v-for="t in xTicks" :key="t.i" :x1="x(t.i)" :x2="x(t.i)" :y1="l.top" :y2="l.top + l.h" />
        </g>
        <text v-for="t in l.ticks" :key="'yl' + t" :x="M.left - 6" :y="l.y(t) + 4" text-anchor="end" class="tick">
          {{ t.toLocaleString("de-DE") }}
        </text>

        <template v-for="line in l.p.lines" :key="line.label">
          <path v-if="line.area" :d="areaPath(line, l.y)" :fill="line.color" class="area" />
          <path :d="linePath(line, l.y)" :stroke="line.color" :class="['line', { dashed: line.dashed }]" />
        </template>

        <g v-if="l.p.violations?.length" class="violations">
          <template v-for="v in l.p.violations" :key="`${v.line}-${v.index}`">
            <circle
              v-if="finite(l.p.lines[v.line]?.values[v.index])"
              :cx="x(v.index)"
              :cy="l.y(l.p.lines[v.line].values[v.index] as number)"
              r="3"
            />
          </template>
        </g>
      </g>

      <!-- Legends carry the hovered values, so they re-render on hover. -->
      <g v-for="l in layout" :key="l.p.id + '-legend'">
        <text :x="width - M.right" :y="l.top - 8" text-anchor="end" class="legend">
          <template v-for="line in l.p.lines" :key="line.label">
            <tspan :fill="line.color" dx="10">{{ line.dashed ? "┅" : "━" }}</tspan>
            <tspan dx="3">{{ line.label }}<template v-if="hover !== null && l.p.lines.length">: {{ valueAt(line, line.kind === 'state' ? hover + 1 : hover) }}</template></tspan>
          </template>
          <template v-for="b in l.p.bands ?? []" :key="b.label">
            <tspan class="band-key" dx="10">▮</tspan><tspan dx="3">{{ b.label }}</tspan>
          </template>
          <template v-if="l.p.violations?.length">
            <tspan class="violation-key" dx="10">●</tspan><tspan dx="3">Limit broken</tspan>
          </template>
        </text>
      </g>

      <g class="x-axis">
        <text v-for="t in xTicks" :key="t.i" :x="x(t.at)" :y="height - 6" text-anchor="middle" class="tick">{{ t.t }}</text>
      </g>

      <g v-if="hover !== null" class="hover">
        <rect :x="x(hover)" :y="0" :width="Math.max(1, x(hover + 1) - x(hover))" :height="height - AXIS_H" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.day-chart { width: 100%; min-width: 0; }
svg { display: block; touch-action: pan-y; }
.readout { font-size: 13px; min-height: 18px; font-variant-numeric: tabular-nums; }
.title { font-size: 13px; font-weight: 600; fill: var(--fg, #1d232a); }
.unit, .legend, .tick { font-size: 11px; fill: #6a737d; font-variant-numeric: tabular-nums; }
.legend { fill: #3b434c; }
.band-key { fill: rgba(47, 158, 68, 0.35); }
.plot-bg { fill: #fafbfc; }
.band { fill: rgba(47, 158, 68, 0.10); }
.bound { fill: none; stroke: rgba(47, 158, 68, 0.75); stroke-width: 1; stroke-dasharray: 4 3; }
.grid line { stroke: #eceff2; stroke-width: 1; }
.line { fill: none; stroke-width: 1.6; stroke-linejoin: round; }
.line.dashed { stroke-width: 1.2; stroke-dasharray: 3 3; }
.area { opacity: 0.12; }
.violations circle { fill: #b42318; stroke: #fff; stroke-width: 1; }
.violation-span { fill: rgba(180, 35, 24, 0.14); }
.violation-key { fill: #b42318; }
.note { color: #b42318; margin-left: 6px; }
.hover rect { fill: rgba(29, 35, 42, 0.08); pointer-events: none; }
</style>
