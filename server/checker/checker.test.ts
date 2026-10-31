/**
 * Verifies the port against the Python reference checker's output.
 * Run standalone with:  node --experimental-strip-types --test server/checker/checker.test.ts
 * (plain `node --test` on Node 23 or newer). Also runs under vitest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckError, simulate, validateSchedule, zoh, type Instance, type Report, type Schedule } from "./checker.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");

interface Fixture {
  instance: Instance;
  cases: Record<string, { schedule: Schedule; expected: Report & { trace_sample: Record<string, (number | null)[]> } }>;
}

function tinyInstance(): Instance {
  return {
    name: "tiny",
    horizon: { steps: 2, dt_hours: 0.25 },
    constants: { air_cp_kj_per_kg_k: 1.0, air_density_kg_per_m3: 1.2, co2_outdoor_ppm: 400.0 },
    room: { volume_m3: 3600.0, thermal_capacity_kwh_per_k: 10.0, ua_kw_per_k: 1.0 },
    hvac: {
      max_mass_flow_kg_per_s: 10.0, max_recirculation: 0.5, fan_power_max_kw: 8.0,
      supply_temp_min_c: 14.0, supply_temp_max_c: 45.0,
      heating_max_kw: 100.0, boiler_efficiency: 0.5, cooling_max_kw: 100.0, chiller_cop: 2.0,
    },
    initial_state: { temperature_c: 20.0, co2_ppm: 500.0 },
    series: {
      price_eur_per_mwh: [100.0, 200.0], outdoor_temp_c: [10.0, 10.0],
      internal_heat_kw: [0.0, 0.0], co2_generation_m3_per_h: [0.0, 0.0], occupancy_persons: [0, 0],
    },
    bounds: { temp_min_c: [0, 0, 0], temp_max_c: [40, 40, 40], co2_max_ppm: [2000, 2000, 2000] },
  };
}

test("zoh: zero rate is linear, tiny rate matches the limit, steady state stays", () => {
  assert.ok(Math.abs(zoh(5, 0, 2, 0.25) - 5.5) < 1e-12);
  assert.ok(Math.abs(zoh(5, 1e-14, 2, 0.25) - 5.5) < 1e-9);
  assert.ok(Math.abs(zoh(4, 2, 8, 10) - 4) < 1e-12);
});

test("cost and dynamics by hand on a two-step instance", () => {
  const inst = tinyInstance();
  const sched: Schedule = { mass_flow_kg_per_s: [5, 0], recirculation: [0, 0], heating_kw: [20, 0], cooling_kw: [0, 0] };
  const rep = simulate(inst, sched);
  assert.equal(rep.feasible, true, JSON.stringify(rep.violations));
  // step 0: fan 8*(0.5)^3 = 1 kW, boiler 20/0.5 = 40 kW -> 41 kW * 0.25 h * 100 EUR/MWh = 1.025 EUR
  assert.ok(Math.abs(rep.cost_eur - 1.025) < 1e-12);
  const a = 0.6, u = 8.0;
  const t1 = 20 * Math.exp(-a * 0.25) + (u / a) * (1 - Math.exp(-a * 0.25));
  const t2 = t1 * Math.exp(-0.1 * 0.25) + (1 / 0.1) * (1 - Math.exp(-0.1 * 0.25));
  assert.ok(Math.abs(rep.final_state.temperature_c - t2) < 1e-9);
  const aC = 15000 / 3600;
  const c1 = 500 * Math.exp(-aC * 0.25) + 400 * (1 - Math.exp(-aC * 0.25));
  assert.ok(Math.abs(rep.final_state.co2_ppm - c1) < 1e-9);
});

test("validateSchedule rejects malformed schedules", () => {
  const inst = tinyInstance();
  assert.throws(() => validateSchedule([], inst), CheckError);
  assert.throws(() => validateSchedule({ mass_flow_kg_per_s: [1, 1], recirculation: [0, 0], heating_kw: [0, 0] }, inst), /missing 'cooling_kw'/);
  assert.throws(() => validateSchedule({ mass_flow_kg_per_s: [1], recirculation: [0, 0], heating_kw: [0, 0], cooling_kw: [0, 0] }, inst), /list of 2 numbers/);
  assert.throws(() => validateSchedule({ mass_flow_kg_per_s: [1, NaN], recirculation: [0, 0], heating_kw: [0, 0], cooling_kw: [0, 0] }, inst), /not a finite number/);
  assert.throws(() => validateSchedule({ instance: "other", mass_flow_kg_per_s: [1, 1], recirculation: [0, 0], heating_kw: [0, 0], cooling_kw: [0, 0] }, inst), /for instance 'other'/);
  validateSchedule({ mass_flow_kg_per_s: [1, 1], recirculation: [0, 0], heating_kw: [0, 0], cooling_kw: [0, 0] }, inst);
});

for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort()) {
  const fixture: Fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf-8"));
  for (const [name, c] of Object.entries(fixture.cases)) {
    test(`${file} / ${name} matches the Python checker`, () => {
      validateSchedule(c.schedule, fixture.instance);
      const rep = simulate(fixture.instance, c.schedule, { trace: true });
      const exp = c.expected;
      assert.equal(rep.feasible, exp.feasible);
      assert.equal(rep.n_violations, exp.n_violations);
      assert.ok(Math.abs(rep.cost_eur - exp.cost_eur) < 1e-6, `cost ${rep.cost_eur} vs ${exp.cost_eur}`);
      for (const k of ["fan", "heating", "cooling"] as const) {
        assert.ok(Math.abs(rep.cost_breakdown_eur[k] - exp.cost_breakdown_eur[k]) < 1e-6, `breakdown ${k}`);
        assert.ok(Math.abs(rep.energy_kwh[k] - exp.energy_kwh[k]) < 1e-6, `energy ${k}`);
      }
      assert.ok(Math.abs(rep.final_state.temperature_c - exp.final_state.temperature_c) < 1e-8);
      assert.ok(Math.abs(rep.final_state.co2_ppm - exp.final_state.co2_ppm) < 1e-6);
      // violations: same first 50, same constraint names and steps
      const want = exp.violations;
      const got = rep.violations.slice(0, want.length);
      assert.deepEqual(got.map((v) => [v.step, v.constraint]), want.map((v) => [v.step, v.constraint]));
      // trace samples
      const t = rep.trace!;
      for (const [key, sample] of Object.entries(exp.trace_sample)) {
        const arr = (t as unknown as Record<string, (number | null)[]>)[key];
        sample.forEach((v, i) => {
          const g = arr[i * 37];
          if (v === null) assert.equal(g, null);
          else assert.ok(Math.abs((g as number) - v) < 1e-6, `trace ${key}[${i * 37}] ${g} vs ${v}`);
        });
      }
    });
  }
}
