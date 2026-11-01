<script setup lang="ts">
/**
 * What maintenance does to the stored plan. Feasibility comes first: nothing is re-planned, so
 * blocking an asset can only lower the cost, and that drop must not read as a saving.
 */
import { computed } from "vue";
import type { Consequences } from "../api";
import { amount } from "../violations";

const props = defineProps<{ report: Consequences; title: string }>();

const LIMITS: Record<string, { label: string; unit: string; digits: number }> = {
  temp_below_min: { label: "Temperature too low", unit: "°C", digits: 2 },
  temp_above_max: { label: "Temperature too high", unit: "°C", digits: 2 },
  co2_above_max: { label: "CO₂ too high", unit: "ppm", digits: 0 },
  supply_temp_range: { label: "Supply air outside its limits", unit: "°C", digits: 2 },
};
const limit = (c: string) => LIMITS[c] ?? { label: c, unit: "", digits: 2 };

const eur = (v: number) => Math.abs(v).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
/** "2026-10-08T06:15" -> "2026-10-08 06:15" */
const time = (local: string) => local.replace("T", " ");
const hours = (count: number) => (count / 4).toLocaleString("de-DE", { maximumFractionDigits: 2 });

const hasSupplyAir = computed(() => props.report.new_violations.some((g) => g.constraint === "supply_temp_range"));
const costFalls = computed(() => props.report.cost_change_total_eur < -0.005);
</script>

<template>
  <div class="consequences">
    <h2>{{ title }}</h2>
    <p v-if="!report.windows.length" class="muted">No maintenance windows are in force.</p>
    <p v-else-if="!report.plan_changed" class="ok" role="status">
      No effect on the plan: it doesn't use this equipment during the {{ report.blocked_steps ? "window" : "data period" }}.
    </p>
    <template v-else>
      <p v-if="report.still_feasible" class="ok" role="status">The plan still keeps all limits.</p>
      <p v-else class="error" role="status">
        <strong>The plan no longer keeps all limits</strong>: {{ report.new_violations_total }} new
        violation{{ report.new_violations_total === 1 ? "" : "s" }},
        {{ report.new_violations_on_day }} of them on {{ report.date }}.
      </p>

      <table v-if="report.new_violations.length">
        <thead><tr><th>New violation</th><th>Duration</th><th>Worst</th><th>First</th><th>Last</th></tr></thead>
        <tbody>
          <tr v-for="g in report.new_violations" :key="g.constraint">
            <td>{{ limit(g.constraint).label }}</td>
            <td>{{ hours(g.count) }} h</td>
            <td>{{ amount(g.worst, limit(g.constraint).digits) }} {{ limit(g.constraint).unit }} past the limit</td>
            <td>{{ time(g.first_local) }}</td>
            <td>{{ time(g.last_local) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="hasSupplyAir" class="muted small">
        Supply air: the air leaving the unit is outside its allowed range because the equipment that would condition it is off.
      </p>

      <p class="cost">
        <template v-if="costFalls">
          Energy cost falls by {{ eur(report.cost_change_on_day_eur) }} on {{ report.date }} and
          {{ eur(report.cost_change_total_eur) }} over the data period. This is not a saving: the equipment is off and nothing makes up for it.
        </template>
        <template v-else>Energy cost is unchanged.</template>
      </p>
    </template>
    <p class="muted small">
      Prediction from the simulation: the stored plan with the equipment off and nothing else re-planned, simulated from the start of the data period, not from current sensor readings. Because the plan never adapts, effects long after the window are a worst case.
    </p>
  </div>
</template>

<style scoped>
h2 { margin: 0 0 6px; font-size: 15px; }
.ok { color: #2b8a3e; }
.cost { margin-bottom: 4px; }
table { margin: 8px 0; }
.small { font-size: 12px; }
</style>
