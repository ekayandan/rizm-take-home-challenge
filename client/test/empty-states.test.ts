/** Issue 7: pages explain missing data in plain words and never load forever. IDs are in task-7.md. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import HallDayView from "../src/views/HallDayView.vue";
import HallView from "../src/views/HallView.vue";
import HomeView from "../src/views/HomeView.vue";
import BreachList from "../src/components/BreachList.vue";
import { useAuthStore } from "../src/stores/auth";
import { useSitesStore } from "../src/stores/sites";
import { BAD_GATEWAY, dayReport, daySeries, hallDetail, settle, siteHall, siteOf, stubFetch, testRouter, type Script } from "./helpers";

const HALL = "GET /halls/halle-a";
const SERIES = "GET /halls/halle-a/series";
const VIOLATIONS = "GET /halls/halle-a/violations";
const COST = "GET /halls/halle-a/cost";
const LIST = "GET /halls/halle-a/maintenance";
const noData = { status: 400, body: { error: "no data for hall 'halle-a' between 2026-10-06 and 2026-10-06" } };
const notFound = { status: 404, body: { error: "hall 'halle-a' not found" } };
const RAW = /halle-a'|between \d|'from'|must be a date|failed to fetch|bad gateway|502/i;

let w: VueWrapper<any>;
const stubs = { DayChart: true, DayPicker: true, RouterLink: { template: "<a><slot /></a>" } };

async function mountAt(component: any, url: string, props: Record<string, unknown>) {
  const router = testRouter(url);
  await router.isReady();
  w = mount(component, { props, global: { plugins: [router], stubs } });
  await settle();
  return w;
}
const dayView = (date: string, script: Script) => {
  stubFetch({ [LIST]: { body: [] }, ...script });
  return mountAt(HallDayView, `/halls/halle-a/days/${date}`, { hallId: "halle-a", date });
};
const hallView = (script: Script) => {
  stubFetch(script);
  return mountAt(HallView, "/halls/halle-a", { hallId: "halle-a" });
};
const home = (url = "/", sites: unknown[] = []) => {
  stubFetch({ "GET /sites/suedwerk/cost": { body: { site_id: "suedwerk", date: "2026-10-05", schedule: "optimized", total_cost_eur: null, complete: false, halls: [] } } });
  useSitesStore().sites = sites as never;
  return mountAt(HomeView, url, {});
};
const retryButton = () => w.findAll("button").find((b) => /try again|retry/i.test(b.text()));

beforeEach(() => {
  setActivePinia(createPinia());
  useAuthStore().user = { id: "u", name: "U", email: "u@x", role: "operator", sites: [] };
});
afterEach(() => {
  w.unmount();
  vi.unstubAllGlobals();
});

describe("sites page", () => {
  test("P3: no sites explains who to ask, and drops the empty Day label", async () => {
    await home();
    expect(w.text()).toMatch(/no sites.*(account|admin)/i);
    expect(w.text()).not.toMatch(/^Sites\s*Day/);
    expect(w.find(".date-picker").exists()).toBe(false);
  });

  test("P5: a site without halls says so instead of an empty table", async () => {
    await home("/", [siteOf([], { first_date: null, last_date: null })]);
    expect(w.text()).toMatch(/no halls/i);
    expect(w.find("table").exists()).toBe(false);
  });

  test("P6: a hall without a schedule avoids internal wording", async () => {
    stubFetch({ "GET /sites/suedwerk/cost": { body: {
      site_id: "suedwerk", date: "2026-10-05", schedule: "optimized", total_cost_eur: null, complete: false,
      halls: [{ hall_id: "halle-a", name: "Halle A", cost_eur: null, reason: "no 'optimized' schedule" }],
    } } });
    useSitesStore().sites = [siteOf([siteHall()])] as never;
    await mountAt(HomeView, "/", {});
    expect(w.text()).not.toMatch(/'optimized'/);
    expect(w.text()).toMatch(/no .*schedule/i);
  });

  test("P12: a date outside the data says what the data covers", async () => {
    await home("/?date=2030-01-01", [siteOf([siteHall()])]);
    expect(w.text()).toMatch(/covers|available from/i);
    expect(w.text()).toMatch(/2026-10-05|5 Oct/);
  });

  test("C4: a failed sites load shows in the main area with a retry that works", async () => {
    stubFetch({ "GET /sites": [BAD_GATEWAY, { body: [] }] });
    const store = useSitesStore();
    await store.load();
    await mountAt(HomeView, "/", {});
    expect(w.text()).toMatch(/not reachable|not available|unavailable/i);
    await retryButton()!.trigger("click");
    await settle();
    expect(store.error).toBeNull();
  });
});

describe("hall page", () => {
  test("P7: a hall without days explains it and stops loading", async () => {
    await hallView({ [HALL]: { body: hallDetail({ days: [], first_date: null, last_date: null, schedules: [] }) } });
    expect(w.text()).not.toMatch(/loading/i);
    expect(w.text()).toMatch(/no (days|data)/i);
    expect(w.text()).not.toMatch(/null/);
  });

  test("P7: a hall without schedules explains it instead of an empty table", async () => {
    await hallView({
      [HALL]: { body: hallDetail({ schedules: [] }) },
      [COST]: { body: { hall_id: "halle-a", date: "2026-10-05", schedules: {} } },
    });
    expect(w.text()).toMatch(/no schedules/i);
    expect(w.find("table").exists()).toBe(false);
  });

  test("P4, P13: an unknown hall is explained without its ID, with a way back", async () => {
    await hallView({ [HALL]: notFound });
    expect(w.text()).toMatch(/couldn't find that hall/i);
    expect(w.text()).not.toMatch(RAW);
    expect(w.text()).toMatch(/sites/i);
  });

  test("C4: a failed load offers a retry that works", async () => {
    await hallView({
      [HALL]: [BAD_GATEWAY, { body: hallDetail() }],
      [COST]: { body: { hall_id: "halle-a", date: "2026-10-05", schedules: {} } },
    });
    expect(w.text()).not.toMatch(RAW);
    await retryButton()!.trigger("click");
    await settle();
    expect(w.text()).toContain("Halle A");
  });
});

describe("day view", () => {
  test("P8: a hall without schedules doesn't keep loading", async () => {
    await dayView("2026-10-05", { [HALL]: { body: hallDetail({ schedules: [] }) } });
    expect(w.text()).toMatch(/no schedules/i);
    expect(w.text()).not.toMatch(/loading day/i);
  });

  test("P9: a missing day inside the data names the missing prices", async () => {
    await dayView("2026-10-06", { [HALL]: { body: hallDetail() }, [SERIES]: noData, [VIOLATIONS]: noData, [COST]: noData });
    expect(w.text()).toMatch(/no price data/i);
    expect(w.text()).toContain("Halle A");
    expect(w.text()).not.toMatch(RAW);
  });

  test("P12: a date outside the data says what the data covers", async () => {
    await dayView("2026-12-25", { [HALL]: { body: hallDetail() }, [SERIES]: noData, [VIOLATIONS]: noData, [COST]: noData });
    expect(w.text()).toMatch(/covers/i);
    expect(w.text()).toMatch(/2026-10-05|5 Oct/);
    expect(w.text()).not.toMatch(RAW);
  });

  test.each(["2026-13-45", "abc", "2026-02-30"])("P11: the invalid date %s is explained", async (date) => {
    const bad = { status: 400, body: { error: `'from' must be a date as YYYY-MM-DD, got '${date}'` } };
    await dayView(date, { [HALL]: { body: hallDetail() }, [SERIES]: bad, [VIOLATIONS]: bad, [COST]: bad });
    expect(w.text()).toMatch(/isn't a valid date|not a valid date|date isn't valid/i);
    expect(w.text()).not.toMatch(RAW);
  });

  test("P4, P13: an unknown hall is explained without its ID", async () => {
    await dayView("2026-10-05", { [HALL]: notFound });
    expect(w.text()).toMatch(/couldn't find that hall/i);
    expect(w.text()).not.toMatch(RAW);
  });

  const withReadings = (temperature: (number | null)[], co2: (number | null)[]): Script => ({
    [HALL]: { body: hallDetail() },
    [SERIES]: { body: daySeries(temperature, co2) },
    [VIOLATIONS]: { body: { step_start: 0, step_end: 2, violations: [] } },
    [COST]: (url) => {
      const name = new URL(url, "http://x").searchParams.get("schedule")!;
      return { body: { schedules: { [name]: dayReport(name) } } };
    },
  });

  test("P10: no sensor readings doesn't report all clear", async () => {
    const none = [null, null, null];
    await dayView("2026-10-05", withReadings(none, none));
    expect(w.text()).not.toMatch(/stayed within/i);
    expect(w.text()).toMatch(/no sensor readings/i);
  });

  test("P10: partial readings say only part of the day was checked", async () => {
    await dayView("2026-10-05", withReadings([20, null, 20], [500, null, 500]));
    expect(w.text()).not.toMatch(/measured climate stayed within/i);
    expect(w.text()).toMatch(/some sensor readings|part of the day|readings are missing/i);
  });

  test("P10: full readings within limits still report all clear", async () => {
    await dayView("2026-10-05", withReadings([20, 20, 20], [500, 500, 500]));
    expect(w.text()).toMatch(/measured climate stayed within limits/i);
  });

  test("C4: a failed day load offers a retry that works", async () => {
    const ok = withReadings([20, 20, 20], [500, 500, 500]);
    await dayView("2026-10-05", { ...ok, [SERIES]: [BAD_GATEWAY, ok[SERIES] as never] });
    expect(w.text()).not.toMatch(RAW);
    await retryButton()!.trigger("click");
    await settle();
    await flushPromises();
    expect(w.text()).toMatch(/measured climate stayed within limits/i);
  });
});

describe("P10: breach list", () => {
  const list = (temperature: (number | null)[]) => {
    const series = daySeries(temperature, temperature);
    w = mount(BreachList, {
      props: { breaches: [], series, times: ["00:00", "00:15", "24:00"], plan: series.schedules.optimized, planLabel: "Optimized" },
    });
  };

  test("without readings it doesn't claim the limits were kept", () => {
    list([null, null, null]);
    expect(w.text()).not.toMatch(/stayed within/i);
    expect(w.text()).toMatch(/no sensor readings/i);
  });

  test("with readings it still does", () => {
    list([20, 20, 20]);
    expect(w.text()).toMatch(/stayed within/i);
  });
});
