import { expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import type { Consequences } from "../src/api";
import ConsequencesSummary from "../src/components/ConsequencesSummary.vue";

const report = (over: Partial<Consequences>) => ({
  hall_id: "h", schedule: "optimized", date: "2026-10-08",
  windows: [{ asset: "boiler", start_utc: "a", end_utc: "b" }],
  blocked_steps: 32, changed_steps: 10, plan_changed: true, still_feasible: true,
  new_violations: [], new_violations_total: 0, new_violations_on_day: 0,
  cost_change_on_day_eur: -5, cost_change_total_eur: -5,
  ...over,
}) as Consequences;
const text = (r: Consequences) => mount(ConsequencesSummary, { props: { report: r, title: "T" } }).text();

test("a broken plan leads with feasibility and lists what broke", () => {
  const t = text(report({
    still_feasible: false, new_violations_total: 8, new_violations_on_day: 6,
    new_violations: [{ constraint: "temp_below_min", count: 8, worst: 1.5, first_local: "2026-10-08T07:00", last_local: "2026-10-08T09:00" }],
  }));
  expect(t).toContain("no longer keeps all limits");
  expect(t).toContain("6 of them on 2026-10-08");
  expect(t).toContain("Temperature too low");
  expect(t).toContain("2 h");
});

test("a lower cost is never called a saving", () => {
  expect(text(report({}))).toContain("This is not a saving");
});

test("equipment the plan doesn't use is said to have no effect", () => {
  expect(text(report({ plan_changed: false }))).toContain("No effect on the plan");
});

test("the result says it is a prediction without re-planning", () => {
  expect(text(report({}))).toContain("nothing else re-planned");
});
