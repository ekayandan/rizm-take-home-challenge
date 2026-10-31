/**
 * Checker and simulator for the hall HVAC model.
 *
 * This is a line-by-line port of the Python reference checker (algorithm kit, checker.py)
 * and is verified against its output on the fixtures in ./fixtures. `simulate()` runs a
 * schedule through the model and returns the recomputed cost and every constraint
 * violation. It is pure, synchronous and has no dependencies.
 *
 * Time is discrete: steps k = 0 … N-1 of dtHours each. The state at the start of step k
 * is hall temperature T_k (°C) and CO2 C_k (ppm); state N is the end of the horizon.
 * Bounds arrays have N+1 entries, series and schedule arrays have N entries.
 */

export const TOL = 1e-6; // absolute tolerance on every inequality

export const SCHEDULE_KEYS = ["mass_flow_kg_per_s", "recirculation", "heating_kw", "cooling_kw"] as const;
export type ScheduleKey = (typeof SCHEDULE_KEYS)[number];

export interface Instance {
  name?: string;
  horizon: { steps: number; dt_hours: number };
  constants: { air_cp_kj_per_kg_k: number; air_density_kg_per_m3: number; co2_outdoor_ppm: number };
  room: { volume_m3: number; thermal_capacity_kwh_per_k: number; ua_kw_per_k: number };
  hvac: {
    max_mass_flow_kg_per_s: number;
    max_recirculation: number;
    fan_power_max_kw: number;
    supply_temp_min_c: number;
    supply_temp_max_c: number;
    heating_max_kw: number;
    boiler_efficiency: number;
    cooling_max_kw: number;
    chiller_cop: number;
  };
  initial_state: { temperature_c: number; co2_ppm: number };
  series: {
    price_eur_per_mwh: number[];
    outdoor_temp_c: number[];
    internal_heat_kw: number[];
    co2_generation_m3_per_h: number[];
    occupancy_persons?: number[];
  };
  bounds: { temp_min_c: number[]; temp_max_c: number[]; co2_max_ppm: number[] };
}

export interface Schedule {
  instance?: string;
  mass_flow_kg_per_s: number[];
  recirculation: number[];
  heating_kw: number[];
  cooling_kw: number[];
}

export interface Violation {
  step: number;
  constraint: string;
  value: number | number[];
  limit: number | number[];
}

export interface StepInfo {
  fresh_kg_per_s: number;
  t_mix_c: number;
  t_sup_c: number | null;
  p_fan_kw: number;
  p_heat_kw: number;
  p_cool_kw: number;
  p_el_kw: number;
  cost_eur: number;
}

export interface Trace {
  temperature_c: number[]; // N+1
  co2_ppm: number[]; // N+1
  t_sup_c: (number | null)[]; // N
  p_el_kw: number[]; // N
  cost_eur: number[]; // N
}

export interface Report {
  instance: string | null;
  feasible: boolean;
  cost_eur: number;
  cost_breakdown_eur: { fan: number; heating: number; cooling: number };
  energy_kwh: { fan: number; heating: number; cooling: number; total: number };
  n_violations: number;
  violations: Violation[];
  final_state: { temperature_c: number; co2_ppm: number };
  trace?: Trace;
}

export class CheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckError";
  }
}

/** Exact solution of dx/dt = -a*x + u after time dt, for a >= 0. */
export function zoh(x: number, a: number, u: number, dt: number): number {
  if (a <= 0) return x + u * dt;
  const e = Math.exp(-a * dt);
  return x * e + (u * -Math.expm1(-a * dt)) / a;
}

/**
 * Advance one step. Returns the next state and the derived quantities of the step
 * (fresh mass flow, mixed and supply temperature, electric power, cost). No constraint
 * is checked here.
 */
export function step(
  inst: Instance,
  T: number,
  C: number,
  k: number,
  m: number,
  r: number,
  h: number,
  c: number,
): { T: number; C: number; info: StepInfo } {
  const { constants: cst, room, hvac, series: s } = inst;
  const dt = inst.horizon.dt_hours;
  const cp = cst.air_cp_kj_per_kg_k;
  const rho = cst.air_density_kg_per_m3;
  const cOut = cst.co2_outdoor_ppm;
  const tOut = s.outdoor_temp_c[k];
  const qInt = s.internal_heat_kw[k];
  const gen = s.co2_generation_m3_per_h[k];
  const price = s.price_eur_per_mwh[k];

  const fresh = m * (1 - r); // kg/s of outdoor air
  const qFresh = (fresh / rho) * 3600; // m3/h of outdoor air
  const tMix = r * T + (1 - r) * tOut;
  const tSup = m > 0 ? tMix + (h - c) / (m * cp) : null;

  // temperature: C_th dT/dt = fresh*cp*(T_out - T) + UA*(T_out - T) + Q_int + h - c
  const cth = room.thermal_capacity_kwh_per_k;
  const ua = room.ua_kw_per_k;
  const aT = (fresh * cp + ua) / cth;
  const uT = (fresh * cp * tOut + ua * tOut + qInt + h - c) / cth;
  const tNext = zoh(T, aT, uT, dt);

  // CO2: V dC/dt = q_fresh*(C_out - C) + 1e6*G
  const vol = room.volume_m3;
  const aC = qFresh / vol;
  const uC = (qFresh * cOut + 1e6 * gen) / vol;
  const cNext = zoh(C, aC, uC, dt);

  const pFan = hvac.fan_power_max_kw * (m / hvac.max_mass_flow_kg_per_s) ** 3;
  const pHeat = h / hvac.boiler_efficiency;
  const pCool = c / hvac.chiller_cop;
  const pEl = pFan + pHeat + pCool;
  const cost = (price * dt * pEl) / 1000;

  return {
    T: tNext,
    C: cNext,
    info: { fresh_kg_per_s: fresh, t_mix_c: tMix, t_sup_c: tSup, p_fan_kw: pFan, p_heat_kw: pHeat, p_cool_kw: pCool, p_el_kw: pEl, cost_eur: cost },
  };
}

function checkState(k: number, T: number, C: number, b: Instance["bounds"], violations: Violation[]): void {
  if (T < b.temp_min_c[k] - TOL) violations.push({ step: k, constraint: "temp_below_min", value: T, limit: b.temp_min_c[k] });
  if (T > b.temp_max_c[k] + TOL) violations.push({ step: k, constraint: "temp_above_max", value: T, limit: b.temp_max_c[k] });
  if (C > b.co2_max_ppm[k] + TOL) violations.push({ step: k, constraint: "co2_above_max", value: C, limit: b.co2_max_ppm[k] });
}

/**
 * Simulate a schedule and check every constraint. Pass `{ trace: true }` to also get
 * the state and power trajectories.
 */
export function simulate(inst: Instance, schedule: Schedule, opts: { trace?: boolean } = {}): Report {
  const n = inst.horizon.steps;
  const dt = inst.horizon.dt_hours;
  const { hvac, bounds: b } = inst;
  const mMax = hvac.max_mass_flow_kg_per_s;
  const rMax = hvac.max_recirculation;
  const hMax = hvac.heating_max_kw;
  const cMax = hvac.cooling_max_kw;
  const tsMin = hvac.supply_temp_min_c;
  const tsMax = hvac.supply_temp_max_c;

  const ms = schedule.mass_flow_kg_per_s;
  const rs = schedule.recirculation;
  const hs = schedule.heating_kw;
  const cs = schedule.cooling_kw;

  const violations: Violation[] = [];
  const viol = (k: number, constraint: string, value: number | number[], limit: number | number[]) =>
    violations.push({ step: k, constraint, value, limit });

  let T = inst.initial_state.temperature_c;
  let C = inst.initial_state.co2_ppm;
  let cost = 0, fan = 0, heat = 0, cool = 0;
  let eFan = 0, eHeat = 0, eCool = 0;
  const trace: Trace | undefined = opts.trace
    ? { temperature_c: [T], co2_ppm: [C], t_sup_c: [], p_el_kw: [], cost_eur: [] }
    : undefined;

  checkState(0, T, C, b, violations);

  for (let k = 0; k < n; k++) {
    let m = ms[k], r = rs[k], h = hs[k], c = cs[k];
    // control bounds
    if (m < -TOL || m > mMax + TOL) viol(k, "mass_flow_range", m, [0, mMax]);
    if (r < -TOL || r > rMax + TOL) viol(k, "recirculation_range", r, [0, rMax]);
    if (h < -TOL || h > hMax + TOL) viol(k, "heating_range", h, [0, hMax]);
    if (c < -TOL || c > cMax + TOL) viol(k, "cooling_range", c, [0, cMax]);
    if (Math.min(h, c) > TOL) viol(k, "heating_and_cooling_together", [h, c], 0);
    // clamp tiny negatives so the physics stay sane
    m = Math.min(Math.max(m, 0), mMax);
    r = Math.min(Math.max(r, 0), rMax);
    h = Math.max(h, 0);
    c = Math.max(c, 0);

    const next = step(inst, T, C, k, m, r, h, c);

    // supply air temperature: coils can only act on air that flows
    if (m > 0) {
      const tSup = next.info.t_sup_c as number;
      if (tSup < tsMin - TOL || tSup > tsMax + TOL) viol(k, "supply_temp_range", tSup, [tsMin, tsMax]);
    } else if (h > TOL || c > TOL) {
      viol(k, "coil_power_without_airflow", [h, c], 0);
    }

    checkState(k + 1, next.T, next.C, b, violations);

    const price = inst.series.price_eur_per_mwh[k];
    cost += next.info.cost_eur;
    fan += (price * dt * next.info.p_fan_kw) / 1000;
    heat += (price * dt * next.info.p_heat_kw) / 1000;
    cool += (price * dt * next.info.p_cool_kw) / 1000;
    eFan += next.info.p_fan_kw * dt;
    eHeat += next.info.p_heat_kw * dt;
    eCool += next.info.p_cool_kw * dt;
    if (trace) {
      trace.temperature_c.push(next.T);
      trace.co2_ppm.push(next.C);
      trace.t_sup_c.push(next.info.t_sup_c);
      trace.p_el_kw.push(next.info.p_el_kw);
      trace.cost_eur.push(next.info.cost_eur);
    }
    T = next.T;
    C = next.C;
  }

  const report: Report = {
    instance: inst.name ?? null,
    feasible: violations.length === 0,
    cost_eur: cost,
    cost_breakdown_eur: { fan, heating: heat, cooling: cool },
    energy_kwh: { fan: eFan, heating: eHeat, cooling: eCool, total: eFan + eHeat + eCool },
    n_violations: violations.length,
    violations,
    final_state: { temperature_c: T, co2_ppm: C },
  };
  if (trace) report.trace = trace;
  return report;
}

/** Throws CheckError when the instance arrays do not match the horizon. */
export function validateInstance(inst: Instance): void {
  const n = inst?.horizon?.steps;
  if (typeof n !== "number") throw new CheckError("instance is missing horizon.steps");
  for (const key of ["price_eur_per_mwh", "outdoor_temp_c", "internal_heat_kw", "co2_generation_m3_per_h"] as const) {
    if (!Array.isArray(inst.series?.[key]) || inst.series[key].length !== n) throw new CheckError(`series.${key} must have ${n} entries`);
  }
  for (const key of ["temp_min_c", "temp_max_c", "co2_max_ppm"] as const) {
    if (!Array.isArray(inst.bounds?.[key]) || inst.bounds[key].length !== n + 1) throw new CheckError(`bounds.${key} must have ${n + 1} entries`);
  }
}

/** Throws CheckError when the schedule is structurally wrong (not when it is infeasible). */
export function validateSchedule(sched: unknown, inst: Instance): asserts sched is Schedule {
  if (typeof sched !== "object" || sched === null || Array.isArray(sched)) throw new CheckError("schedule must be a JSON object");
  const s = sched as Record<string, unknown>;
  const n = inst.horizon.steps;
  for (const key of SCHEDULE_KEYS) {
    if (!(key in s)) throw new CheckError(`schedule is missing '${key}'`);
    const arr = s[key];
    if (!Array.isArray(arr) || arr.length !== n) throw new CheckError(`schedule.${key} must be a list of ${n} numbers`);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new CheckError(`schedule.${key}[${i}] is not a finite number: ${JSON.stringify(v)}`);
    }
  }
  const name = s.instance;
  if (name !== undefined && name !== null && name !== inst.name) throw new CheckError(`schedule is for instance '${name}', not '${inst.name}'`);
}
