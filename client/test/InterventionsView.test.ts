import { beforeEach, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { api, type Intervention } from "../src/api";
import InterventionsView from "../src/views/InterventionsView.vue";

const entry = (over: Partial<Intervention> = {}): Intervention => ({
  id: 1,
  type: "maintenance",
  site_name: "Nordwerk Stade",
  hall_name: "Halle 3 Montage",
  timezone: "Europe/Berlin",
  reason: "Burner inspection",
  created_by_name: "Lena Hartmann",
  created_at: "2026-10-05T15:44:00.000Z",
  revoked_at: null,
  revoked_by_name: null,
  revoke_reason: null,
  asset: "boiler",
  start_utc: "2026-10-06T06:00:00.000Z",
  end_utc: "2026-10-06T12:00:00.000Z",
  ...over,
});

const show = async () => {
  const wrapper = mount(InterventionsView);
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00.000Z"), toFake: ["Date"] });
});

test("a row shows plant, hall, unit, window, user, added time and reason", async () => {
  vi.spyOn(api, "interventions").mockResolvedValue([entry()]);
  const wrapper = await show();
  expect(wrapper.findAll("th").map((c) => c.text())).toEqual(["Plant", "Hall", "Unit disabled", "Disabled", "User", "Added", "Reason"]);
  expect(wrapper.findAll("tbody td").map((c) => c.text())).toEqual([
    "Nordwerk Stade", "Halle 3 Montage", "Boiler", "6 Oct, 08:00 – 14:00", "Lena Hartmann", "5 Oct, 17:44", "Burner inspection",
  ]);
});

test("rows keep the order the server sends", async () => {
  vi.spyOn(api, "interventions").mockResolvedValue([entry({ id: 2, reason: "Second" }), entry({ id: 1, reason: "First" })]);
  const wrapper = await show();
  expect(wrapper.findAll("tbody tr").map((r) => r.findAll("td")[6].text())).toEqual(["Second", "First"]);
});

test("a revoked intervention stays listed and says so", async () => {
  vi.spyOn(api, "interventions").mockResolvedValue([
    entry({ revoked_at: "2026-10-06T07:00:00.000Z", revoked_by_name: "Jonas Weber", revoke_reason: "Mistake" }),
  ]);
  const wrapper = await show();
  expect(wrapper.get("tbody").text()).toContain("Burner inspection");
  expect(wrapper.get(".revoked").text()).toBe("Revoked 6 Oct, 09:00 by Jonas Weber: Mistake");
});

test("an empty history and a failed load each say so", async () => {
  vi.spyOn(api, "interventions").mockResolvedValue([]);
  expect((await show()).text()).toContain("No interventions recorded.");

  vi.spyOn(api, "interventions").mockRejectedValue(new Error("boom"));
  const failed = await show();
  expect(failed.get(".error").text()).toBe("boom");
  expect(failed.find("table").exists()).toBe(false);
});
