import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import DayChart, { type ChartPanel } from "../src/components/DayChart.vue";
import HallWeekView from "../src/views/HallWeekView.vue";
import { api } from "../src/api";

vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));
vi.mock("../src/api", () => ({
  api: { hall: vi.fn(), seriesRange: vi.fn(), violationsRange: vi.fn(), scheduleDayCost: vi.fn() },
}));

const DAY_STEPS = 96;
const dates = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 5 + i));
  return d.toISOString().slice(0, 10);
});
const hhmm = (step: number) =>
  `${String(Math.floor(step / 4)).padStart(2, "0")}:${String((step % 4) * 15).padStart(2, "0")}`;

function fakeHall() {
  return { id: "h", name: "Hall", days: dates.map((date) => ({ date, steps: DAY_STEPS })) };
}
function fakeSeries(from: string, to: string) {
  const days = dates.slice(dates.indexOf(from), dates.indexOf(to) + 1);
  const n = days.length * DAY_STEPS;
  const flat = (len: number, v: number) => Array.from({ length: len }, (_, i) => v + (i % 7));
  return {
    hall_id: "h", from, to, step_start: 0, step_end: n, steps: n, dt_minutes: 15,
    ts_utc: [], state_ts_utc: [],
    local_time: days.flatMap((d) => Array.from({ length: DAY_STEPS }, (_, s) => `${d}T${hhmm(s)}+02:00`)),
    series: { price_eur_per_mwh: flat(n, 90) },
    schedules: {
      optimized: { mass_flow_kg_per_s: flat(n, 2), recirculation: flat(n, 0), heating_kw: flat(n, 5), cooling_kw: flat(n, 0) },
    },
    bounds: { temp_min_c: flat(n + 1, 15), temp_max_c: flat(n + 1, 25), co2_max_ppm: flat(n + 1, 1500) },
    measured: { temperature_c: flat(n + 1, 19), co2_ppm: flat(n + 1, 600) },
  };
}
function fakeCost(date: string) {
  const t = Array.from({ length: DAY_STEPS + 1 }, (_, i) => 19 + (i % 3));
  return { date, step_start: 0, step_end: DAY_STEPS, violations: [], trace: { temperature_c: t, co2_ppm: t } };
}

let wrapper: VueWrapper<any> | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
});

async function weekView(date: string) {
  wrapper = mount(HallWeekView, {
    props: { hallId: "h", date },
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
    attachTo: document.body,
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.mocked(api.hall).mockResolvedValue(fakeHall() as never);
  vi.mocked(api.seriesRange).mockImplementation(async (_i: string, f: string, t: string) => fakeSeries(f, t) as never);
  vi.mocked(api.violationsRange).mockResolvedValue({ step_start: 0, step_end: 0, violations: [] } as never);
  vi.mocked(api.scheduleDayCost).mockImplementation(async (_i: string, d: string) => fakeCost(d) as never);
});

/** The day of the month as a date, not as an hour: matches "13.10." or "10-13", never "13:00". */
const mentionsDay = (text: string, day: number) =>
  new RegExp(`(^|\\D)${day}(?!\\d)`).test(text.replace(/\d{1,2}:\d{2}/g, ""));

/** Fails fast instead of hanging or running out of memory if a loop never ends. */
function guardEndlessPush<T>(fn: () => T): T {
  const original = Array.prototype.push;
  let calls = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    if (++calls > 2_000_000) throw new Error("endless loop");
    return original.apply(this, items);
  };
  try {
    return fn();
  } finally {
    Array.prototype.push = original;
  }
}

const panel = (values: number[], extra: Partial<ChartPanel> = {}): ChartPanel => ({
  id: "p", title: "P", unit: "u", height: 100,
  lines: [{ label: "L", color: "#000", values, kind: "state" }],
  ...extra,
});
const clock = (n: number) => Array.from({ length: n + 1 }, (_, i) => (i === n ? "24:00" : hhmm(i % DAY_STEPS)));

describe("chart with degenerate data", () => {
  test.each([1e17, 5e15, -1e17, 1e300])("flat values of %d do not hang the chart", (v) => {
    const values = Array.from({ length: DAY_STEPS + 1 }, () => v);
    wrapper = guardEndlessPush(() => mount(DayChart, { props: { times: clock(DAY_STEPS), panels: [panel(values)] } }));
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  test("very long series do not overflow the stack", () => {
    const n = 400_000;
    const values = Array.from({ length: n + 1 }, (_, i) => i % 50);
    wrapper = mount(DayChart, {
      props: { times: clock(n), panels: [panel(values, { bands: [{ label: "B", lower: values, upper: values }] })] },
    });
    expect(wrapper.find("svg path").exists()).toBe(true);
  });
});

describe("hover", () => {
  test("does not walk the whole series again", async () => {
    const n = 672;
    let reads = 0;
    const values = new Proxy(Array.from({ length: n + 1 }, (_, i) => i % 50), {
      get(target, key, recv) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, recv);
      },
    });
    wrapper = mount(DayChart, { props: { times: clock(n), panels: [panel(values)] } });
    await flushPromises();
    reads = 0;
    await wrapper.get("svg").trigger("pointermove", { clientX: 400 });
    expect(reads).toBeLessThan(n / 2);
  });
});

describe("week axis", () => {
  const labels = () => wrapper!.findAll(".x-axis text");

  test("labels do not overlap", async () => {
    await weekView("2026-10-12");
    const items = labels().map((l) => ({ x: Number(l.attributes("x")), width: l.text().length * 6.5 }));
    expect(items.length).toBeGreaterThan(1);
    for (let i = 1; i < items.length; i++) {
      const room = items[i].x - items[i - 1].x;
      expect(room).toBeGreaterThanOrEqual((items[i].width + items[i - 1].width) / 2);
    }
  });

  test("the axis names the days of the week", async () => {
    await weekView("2026-10-12");
    const text = labels().map((l) => l.text());
    for (const day of [12, 13, 14, 15, 16, 17, 18]) {
      expect(text.some((t) => mentionsDay(t, day)), `day ${day} in ${text.join(" | ")}`).toBe(true);
    }
  });

  test("the hover readout says which day", async () => {
    await weekView("2026-10-12");
    // Half way along the plot is the fourth day of the week.
    const width = Number(wrapper!.get("svg").attributes("width"));
    await wrapper!.get("svg").trigger("pointermove", { clientX: width / 2 });
    expect(mentionsDay(wrapper!.get(".readout").text(), 15), wrapper!.get(".readout").text()).toBe(true);
  });

  test("a plain day chart keeps its time labels", () => {
    wrapper = mount(DayChart, { props: { times: clock(DAY_STEPS), panels: [panel(Array.from({ length: DAY_STEPS + 1 }, (_, i) => i))] } });
    expect(labels().map((l) => l.text())).toContain("03:00");
  });
});

describe("week page with a date that has no data", () => {
  test.each(["2026-13-45", "1900-01-01", "abc"])("%s explains itself instead of loading forever", async (date) => {
    await weekView(date);
    const text = wrapper!.text();
    expect(text).not.toMatch(/loading/i);
    expect(text).toMatch(/no data|not available|invalid|not found|keine daten/i);
    expect(api.seriesRange).not.toHaveBeenCalled();
  });
});
