/**
 * Chart panels comparing the stored plan with the same plan under maintenance. Only what
 * maintenance can change: indoor climate, and the controls it actually altered that day.
 */
import type { Consequences, HallSeries } from "./api";
import type { ChartPanel, ChartViolation } from "./components/DayChart.vue";
import { amount } from "./violations";

const PLAN = { label: "Stored plan", color: "#1c7ed6" };
const AFTER = { label: "With maintenance", color: "#d9480f" };

const differs = (a: number[], b: number[]) => a.some((v, i) => v !== b[i]);

function afterViolations(report: Consequences, constraints: string[], unit: string, digits: number): ChartViolation[] {
  const day = report.after_day;
  return day.violations
    .filter((v) => constraints.includes(v.constraint))
    .map((v) => ({
      index: v.step - day.step_start,
      line: 1,
      note: `${AFTER.label}: ${amount(Math.abs((v.value as number) - (v.limit as number)), digits)} ${unit} past the limit`,
    }));
}

export function comparisonPanels(series: HallSeries, report: Consequences): ChartPanel[] {
  const plan = series.schedules[report.schedule];
  if (!plan) return [];
  const after = report.after_controls;
  const control = (id: string, title: string, unit: string, term: ChartPanel["term"], before: number[], changed: number[]): ChartPanel[] =>
    differs(before, changed)
      ? [{
          id, title, term, unit, height: 80, include: [0],
          lines: [
            { ...PLAN, values: before, kind: "step", digits: 2 },
            { ...AFTER, values: changed, kind: "step", digits: 2 },
          ],
        }]
      : [];
  return [
    {
      id: "temp", title: "Indoor temperature", term: "temperature", unit: "°C", height: 130,
      lines: [
        { ...PLAN, values: report.plan_day.trace.temperature_c, kind: "state" },
        { ...AFTER, values: report.after_day.trace.temperature_c, kind: "state" },
      ],
      bands: [{ label: "Allowed", lower: series.bounds.temp_min_c, upper: series.bounds.temp_max_c }],
      violations: afterViolations(report, ["temp_below_min", "temp_above_max"], "°C", 2),
    },
    {
      id: "co2", title: "Indoor CO₂", term: "co2", unit: "ppm", height: 110,
      lines: [
        { ...PLAN, values: report.plan_day.trace.co2_ppm, kind: "state", digits: 0 },
        { ...AFTER, values: report.after_day.trace.co2_ppm, kind: "state", digits: 0 },
      ],
      bands: [{ label: "Allowed", upper: series.bounds.co2_max_ppm }],
      violations: afterViolations(report, ["co2_above_max"], "ppm", 0),
    },
    ...control("flow", "Fan mass flow", "kg/s", "massFlow", plan.mass_flow_kg_per_s, after.mass_flow_kg_per_s),
    ...control("heat", "Heating", "kW thermal", "thermalPower", plan.heating_kw, after.heating_kw),
    ...control("cool", "Cooling", "kW thermal", "thermalPower", plan.cooling_kw, after.cooling_kw),
  ];
}
