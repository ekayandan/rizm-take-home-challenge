import { expect, test } from "vitest";
import type { Consequences, HallSeries } from "../src/api";
import { comparisonPanels } from "../src/comparison";

const controls = (heat: number) => ({ mass_flow_kg_per_s: [1, 1], recirculation: [0, 0], heating_kw: [heat, heat], cooling_kw: [0, 0] });
const series = {
  schedules: { optimized: controls(5) },
  bounds: { temp_min_c: [17, 17, 17], temp_max_c: [24, 24, 24], co2_max_ppm: [1100, 1100, 1100] },
} as unknown as HallSeries;
const day = (temp: number) => ({ step_start: 96, violations: [], trace: { temperature_c: [temp, temp, temp], co2_ppm: [700, 700, 700] } });
const report = (heat: number) => ({
  schedule: "optimized", plan_day: day(20), after_day: { ...day(18), violations: [{ step: 97, constraint: "temp_above_max", value: 25, limit: 24 }] }, after_controls: controls(heat),
}) as unknown as Consequences;

test("shows climate and only the controls maintenance changed, never price or cost", () => {
  expect(comparisonPanels(series, report(0)).map((p) => p.id)).toEqual(["temp", "co2", "heat"]);
  expect(comparisonPanels(series, report(5)).map((p) => p.id)).toEqual(["temp", "co2"]);
});

test("compares the plan with maintenance and marks violations on the maintenance line", () => {
  const temp = comparisonPanels(series, report(0))[0];
  expect(temp.lines.map((l) => l.label)).toEqual(["Stored plan", "With maintenance"]);
  expect(temp.violations).toEqual([{ index: 1, line: 1, note: expect.stringContaining("With maintenance") }]);
});
