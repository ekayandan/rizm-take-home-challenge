<script setup lang="ts">
/**
 * The day's measured limit breaches, one row per step, with the price and plan of the step
 * that led to the reading.
 */
import { computed } from "vue";
import type { HallSeries, MeasuredViolation, ScheduleSeries } from "../api";
import { amount, missingReadingsNote, num, readingCoverage } from "../violations";

const props = defineProps<{
  breaches: MeasuredViolation[];
  series: HallSeries;
  /** N+1 local times HH:MM, one per state point. */
  times: string[];
  plan: ScheduleSeries;
  planLabel: string;
}>();

const LABELS: Record<string, string> = {
  temp_below_min: "Temperature too low",
  temp_above_max: "Temperature too high",
  co2_above_max: "CO₂ too high",
};

/** The clock-change night repeats wall-clock times; say which one is meant. */
function timeAt(i: number): string {
  const t = props.times[i];
  const same = props.times.flatMap((x, k) => (x === t ? [k] : []));
  return same.length > 1 ? `${t} (${same.indexOf(i) + 1}${same.indexOf(i) === 0 ? "st" : "nd"})` : t;
}

const coverage = computed(() => readingCoverage(props.series));

const rows = computed(() => {
  const { step_start: start, steps } = props.series;
  return props.breaches.map((v) => {
    const co2 = v.constraint === "co2_above_max";
    const unit = co2 ? "ppm" : "°C";
    const k = Math.min(steps - 1, Math.max(0, v.step - start - 1));
    return {
      key: `${v.constraint}-${v.step}`,
      what: LABELS[v.constraint],
      time: timeAt(v.step - start),
      over: `${amount(v.over, co2 ? 0 : 2)} ${unit}`,
      reading: `${num(v.value, co2 ? 0 : 1)} / ${num(v.limit, co2 ? 0 : 1)} ${unit}`,
      price: num(props.series.series.price_eur_per_mwh[k], 2),
      flow: num(props.plan.mass_flow_kg_per_s[k], 2),
      recirc: num(props.plan.recirculation[k], 2),
      heat: num(props.plan.heating_kw[k], 1),
      cool: num(props.plan.cooling_kw[k], 1),
    };
  });
});
</script>

<template>
  <section class="card breach-list" aria-label="Measured limit breaches">
    <h2>Measured limit breaches <span v-if="coverage.any" class="muted">({{ rows.length }} steps)</span></h2>
    <p v-if="coverage.missing" class="muted">
      {{ missingReadingsNote(coverage) }}
      <template v-if="coverage.any && !rows.length">The readings we have are all within the limits.</template>
    </p>
    <p v-else-if="!rows.length" class="muted">Sensors stayed within all comfort limits on this day.</p>
    <template v-if="rows.length">
      <p class="muted small">Price and {{ planLabel }} plan values are from the {{ series.dt_minutes }} minutes before each reading.</p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th><th>Limit</th><th class="num">Past limit</th><th class="num">Reading / limit</th>
              <th class="num">Price €/MWh</th><th class="num">Fan kg/s</th><th class="num">Recirc.</th><th class="num">Heat kW</th><th class="num">Cool kW</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key">
              <td class="nowrap">{{ r.time }}</td><td>{{ r.what }}</td>
              <td class="num strong">{{ r.over }}</td><td class="num">{{ r.reading }}</td>
              <td class="num">{{ r.price }}</td><td class="num">{{ r.flow }}</td><td class="num">{{ r.recirc }}</td><td class="num">{{ r.heat }}</td><td class="num">{{ r.cool }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.breach-list { margin-top: 16px; }
h2 { margin: 0 0 4px; font-size: 15px; }
.small { font-size: 12px; }
/* Zero intrinsic width: a wide table scrolls here instead of widening the page. */
.scroll { overflow: auto; width: 0; min-width: 100%; max-height: 420px; }
table { width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { padding-left: 6px; padding-right: 6px; }
th { font-weight: 600; font-size: 12px; vertical-align: bottom; position: sticky; top: 0; background: #fff; }
td.num { white-space: nowrap; }
.num { text-align: right; }
.nowrap { white-space: nowrap; }
.strong { font-weight: 600; color: #b42318; }
</style>
