import { beforeEach, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { api, type HallReport, type ReportFigures, type Site, type WeeklyReport } from "../src/api";
import { useSitesStore } from "../src/stores/sites";
import WeeklyReportView from "../src/views/WeeklyReportView.vue";
import { defaultWeek, reportWeeks } from "../src/weeks";

const query: Record<string, string> = {};
vi.mock("vue-router", () => ({ useRoute: () => ({ query }), useRouter: () => ({ replace: vi.fn() }) }));

const figures: ReportFigures = {
  baseline_eur: 100, optimized_eur: 60, post_intervention_eur: 70, savings_eur: 30, intervention_limit_hours: 0, hours_out_of_bounds: 1.25,
  hours_covered: 169, hours_without_price: 0, interventions: 2,
  top_intervals: [{ hall_id: "h", hall_name: "Halle 3", ts_utc: "2026-10-25T00:30:00.000Z", local_date: "2026-10-25", local_time: "02:30 (first, CEST)", price_eur_per_mwh: 90.5, cost_eur: 4 }],
};
const hall: HallReport = { ...figures, hall_id: "h", name: "Halle 3", from: "2026-10-19", to: "2026-10-25" };
const report = (over: Partial<WeeklyReport> = {}): WeeklyReport => ({
  site: { id: "s", name: "Nordwerk", city: "Stade" },
  week: { start: "2026-10-19", end: "2026-10-25", partial: false },
  notes: ["Cost after interventions is the plan."],
  summary: figures,
  halls: [hall],
  ...over,
});

const show = async () => {
  useSitesStore().sites = [{ id: "s", name: "Nordwerk", first_date: "2026-10-05", last_date: "2026-11-03", halls: [] }] as unknown as Site[];
  const wrapper = mount(WeeklyReportView, { props: { siteId: "s" } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

test("weeks run Monday to Sunday, and the default is the last full one", () => {
  const weeks = reportWeeks("2026-10-05", "2026-11-03");
  expect(weeks.map((w) => w.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  expect(weeks.at(-1)).toEqual({ start: "2026-11-02", end: "2026-11-08", partial: true });
  expect(defaultWeek(weeks)).toBe("2026-10-26");
  expect(reportWeeks("2026-10-07", "2026-10-09")).toEqual([{ start: "2026-10-05", end: "2026-10-11", partial: true }]);
  expect(defaultWeek(reportWeeks("2026-10-07", "2026-10-09"))).toBe("2026-10-05");
  expect(defaultWeek([])).toBeNull();
});

test("loads the last full week and offers the CSV of that week", async () => {
  const load = vi.spyOn(api, "weeklyReport").mockResolvedValue(report());
  const wrapper = await show();
  expect(load).toHaveBeenCalledWith("s", "2026-10-26");
  expect(wrapper.find("a.button").attributes("href")).toBe("/api/sites/s/weekly-report.csv?week=2026-10-26");
});

test("the summary comes first, then a print page per hall", async () => {
  vi.spyOn(api, "weeklyReport").mockResolvedValue(report());
  const wrapper = await show();
  const sections = wrapper.findAll("section");
  expect(sections.map((s) => s.find("h2").text())).toEqual(["Site summary", "Halle 3"]);
  expect(sections[0].classes()).not.toContain("print-page");
  expect(sections[1].classes()).toContain("print-page");
  expect(sections[0].text()).toContain("02:30 (first, CEST)");
  expect(sections[0].find("tfoot").text()).toContain("Total");
});

test("a partial week and hours without a price are stated", async () => {
  vi.spyOn(api, "weeklyReport").mockResolvedValue(report({
    week: { start: "2026-11-02", end: "2026-11-08", partial: true },
    halls: [{ ...hall, hours_without_price: 2 }],
  }));
  const wrapper = await show();
  expect(wrapper.text()).toContain("Partial week");
  expect(wrapper.text()).toContain("2 h without a price");
});

test("a failed load says what happened and offers no download", async () => {
  vi.spyOn(api, "weeklyReport").mockRejectedValue(new Error("no data"));
  const wrapper = await show();
  expect(wrapper.find(".error").text()).toBe("no data");
  expect(wrapper.find("a.button").exists()).toBe(false);
});

test("plan limit breaks flag the cost and savings, and the server's notes are shown", async () => {
  const flagged = { intervention_limit_hours: 12.5 };
  vi.spyOn(api, "weeklyReport").mockResolvedValue(report({ summary: { ...figures, ...flagged }, halls: [{ ...hall, ...flagged }] }));
  const wrapper = await show();
  const [summary, hallPage] = wrapper.findAll("section");
  expect(summary.find("tbody .flag").text()).toBe("12,5 h past limits");
  expect(summary.text()).toContain("overstated");
  expect(summary.text()).toContain("Cost after interventions is the plan.");
  expect(hallPage.find(".error").text()).toContain("so the savings below are overstated");
});

test("no flag without plan limit breaks", async () => {
  vi.spyOn(api, "weeklyReport").mockResolvedValue(report());
  const wrapper = await show();
  expect(wrapper.find(".flag").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("overstated");
});
