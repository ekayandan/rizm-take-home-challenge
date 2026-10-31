/** Measured breach detection and how small breaches are shown. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOL } from "../checker/checker.ts";
import { measuredViolations } from "../src/violations.ts";
import type { StepRow } from "../src/repo.ts";
import { amount } from "../../client/src/violations.ts";

const row = (over: Partial<StepRow>): StepRow => ({
  step: 7,
  ts_utc: "2026-10-06T04:00:00Z",
  local_date: "2026-10-06",
  local_time: "06:00",
  utc_offset_min: 120,
  price_eur_per_mwh: 50,
  outdoor_temp_c: 10,
  internal_heat_kw: 0,
  co2_generation_m3_per_h: 0,
  occupancy_persons: 0,
  temp_min_c: 18,
  temp_max_c: 24,
  co2_max_ppm: 1000,
  measured_temperature_c: 20,
  measured_co2_ppm: 600,
  ...over,
});

test("inside the bounds is no breach", () => {
  assert.deepEqual(measuredViolations([row({})]), []);
});

test("each bound is reported with its value, limit and distance", () => {
  const cases = [
    [{ measured_temperature_c: 17 }, "temp_below_min", 17, 18, 1],
    [{ measured_temperature_c: 25.5 }, "temp_above_max", 25.5, 24, 1.5],
    [{ measured_co2_ppm: 1100 }, "co2_above_max", 1100, 1000, 100],
  ] as const;
  for (const [fields, constraint, value, limit, over] of cases) {
    assert.deepEqual(measuredViolations([row(fields)]), [
      { step: 7, ts_utc: "2026-10-06T04:00:00Z", constraint, value, limit, over },
    ]);
  }
});

test("temperature and CO2 at one state point are two breaches", () => {
  const out = measuredViolations([row({ measured_temperature_c: 25, measured_co2_ppm: 1100 })]);
  assert.deepEqual(out.map((v) => v.constraint), ["temp_above_max", "co2_above_max"]);
});

test("the checker's tolerance applies, and anything past it counts", () => {
  assert.deepEqual(measuredViolations([row({ measured_temperature_c: 24 + TOL / 2 })]), []);
  assert.deepEqual(measuredViolations([row({ measured_temperature_c: 24 })]), []);
  assert.equal(measuredViolations([row({ measured_temperature_c: 24 + TOL * 2 })]).length, 1);
});

test("a missing measurement is not a breach", () => {
  assert.deepEqual(measuredViolations([row({ measured_temperature_c: null, measured_co2_ppm: null })]), []);
});

test("a breach below the shown precision does not read as zero", () => {
  assert.equal(amount(0.001, 2), `< ${(0.01).toLocaleString("de-DE")}`);
  assert.equal(amount(1.5, 2), "1,50");
  assert.equal(amount(0.4, 0), "< 1");
});
