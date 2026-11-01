/**
 * Issue 7: what a person is told after each kind of failed save, so they don't retry and create
 * duplicates. IDs are in task-7.md.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import MaintenancePanel from "../src/components/MaintenancePanel.vue";
import { useAuthStore } from "../src/stores/auth";
import { settle, stubFetch, type Script } from "./helpers";

const LIST = "GET /halls/halle-a/maintenance";
const ADD = "POST /halls/halle-a/maintenance";

const row = (id: number, start = "06:00", end = "14:00") => ({
  id, hall_id: "halle-a", asset: "fan",
  start_utc: `2026-10-06T${start}:00.000Z`, end_utc: `2026-10-06T${end}:00.000Z`,
  start_local: `2026-10-06T${start}+02:00`, end_local: `2026-10-06T${end}+02:00`,
  created_by: "u", created_by_name: "Jonas Weber", created_at: "2026-10-01T00:00:00Z",
});
const other = row(1, "16:00", "17:00");
const saved = row(2); // matches the form's default 06:00 to 14:00

let w: VueWrapper<any>;
async function panel(script: Script) {
  const stub = stubFetch(script);
  w = mount(MaintenancePanel, { props: { hallId: "halle-a", date: "2026-10-06", timezone: "Europe/Berlin" } });
  await settle();
  return stub;
}
const save = async () => {
  await w.get('[name="reason"]').setValue("Belt change");
  await w.get("form").trigger("submit");
  await settle();
};
const button = () => w.get("form button");

beforeEach(() => {
  setActivePinia(createPinia());
  useAuthStore().user = { id: "u", name: "U", email: "u@x", role: "operator", sites: [] };
  sessionStorage.clear();
});
afterEach(() => {
  w.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("P23: a successful save says so", async () => {
  await panel({ [LIST]: [{ body: [other] }, { body: [other, saved] }], [ADD]: { status: 201, body: saved } });
  await save();
  expect(w.get('[role="status"]').text()).toMatch(/saved/i);
  expect(w.findAll("tbody tr")).toHaveLength(2);
});

test("P14: rejected before reaching the server, the list proves nothing was saved", async () => {
  const { calls } = await panel({ [LIST]: { body: [other] }, [ADD]: "network-error" });
  await save();
  expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  expect(w.text()).toMatch(/not saved|nothing was saved/i);
  expect(w.text()).not.toMatch(/failed to fetch/i);
  expect((button().element as HTMLButtonElement).disabled).toBe(false);
});

test("P15: response lost after saving, the list proves it was saved", async () => {
  await panel({ [LIST]: [{ body: [other] }, { body: [other, saved] }], [ADD]: "network-error" });
  await save();
  expect(w.get('[role="status"]').text()).toMatch(/saved/i);
  expect(w.text()).not.toMatch(/not saved|nothing was saved|failed to fetch/i);
});

test("P15: an existing window with the same times from before the attempt still counts as saved", async () => {
  await panel({ [LIST]: { body: [saved] }, [ADD]: "network-error" });
  await save();
  expect(w.text()).not.toMatch(/not saved|nothing was saved/i);
});

test("P15: when neither save nor list can be confirmed, it says the outcome is unknown", async () => {
  await panel({ [LIST]: [{ body: [other] }, "network-error"], [ADD]: "network-error" });
  await save();
  expect(w.text()).toMatch(/can't tell|cannot tell|may or may not|not sure/i);
  expect(w.text()).not.toMatch(/failed to fetch/i);
});

test("P16: saved but the list failed to refresh is reported as saved", async () => {
  await panel({ [LIST]: [{ body: [other] }, "network-error"], [ADD]: { status: 201, body: saved } });
  await save();
  expect(w.get('[role="status"]').text()).toMatch(/saved/i);
  expect(w.text()).toMatch(/list could not be refreshed|couldn't refresh|could not refresh/i);
  expect(w.text()).not.toMatch(/failed to fetch/i);
});

test("P20: a failed refresh keeps the rows and marks them as possibly out of date", async () => {
  await panel({ [LIST]: [{ body: [other] }, "network-error"], [ADD]: { status: 201, body: saved } });
  await save();
  expect(w.findAll("tbody tr").length).toBeGreaterThan(0);
  expect(w.text()).toMatch(/out of date|may not be current/i);
});

test("P17: a hanging save times out and says the outcome is unknown", async () => {
  // The timeout has to use setTimeout (with AbortController) for fake timers to reach it.
  await panel({ [LIST]: [{ body: [other] }, "network-error"], [ADD]: "hang" });
  await w.get('[name="reason"]').setValue("Belt change");
  vi.useFakeTimers();
  w.get("form").trigger("submit");
  await vi.advanceTimersByTimeAsync(60_000);
  vi.useRealTimers();
  await settle();
  expect(button().text()).not.toMatch(/saving/i);
  expect((button().element as HTMLButtonElement).disabled).toBe(false);
  expect(w.text()).toMatch(/can't tell|cannot tell|may or may not|not sure/i);
});

test("C1: a duplicate shows who recorded it and refreshes the list", async () => {
  const { calls } = await panel({
    [LIST]: [{ body: [other] }, { body: [other, saved] }],
    [ADD]: { status: 409, body: { error: "Already recorded by Jonas Weber." } },
  });
  await save();
  expect(w.text()).toMatch(/Already recorded by Jonas Weber/);
  expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  expect(w.findAll("tbody tr")).toHaveLength(2);
});

describe("P18: session expiry", () => {
  test("the entered times survive the trip through login", async () => {
    await panel({ [LIST]: { body: [] }, [ADD]: { status: 401, body: { error: "login required" } } });
    await w.get('[name="start"]').setValue("2026-10-06T09:15");
    await w.get('[name="end"]').setValue("2026-10-06T10:45");
    await save();
    w.unmount();

    await panel({ [LIST]: { body: [] } });
    expect((w.get('[name="start"]').element as HTMLInputElement).value).toBe("2026-10-06T09:15");
    expect((w.get('[name="end"]').element as HTMLInputElement).value).toBe("2026-10-06T10:45");
  });

  test("a restored draft is used once", async () => {
    await panel({ [LIST]: { body: [] }, [ADD]: { status: 401, body: { error: "login required" } } });
    await w.get('[name="start"]').setValue("2026-10-06T09:15");
    await save();
    w.unmount();
    await panel({ [LIST]: { body: [] } });
    w.unmount();

    await panel({ [LIST]: { body: [] } });
    expect((w.get('[name="start"]').element as HTMLInputElement).value).toBe("2026-10-06T06:00");
  });
});

test("C4: a failed list load offers a retry that works", async () => {
  await panel({ [LIST]: ["network-error", { body: [other] }] });
  expect(w.text()).not.toMatch(/failed to fetch/i);
  const retry = w.findAll("button").find((b) => /try again|retry/i.test(b.text()));
  await retry!.trigger("click");
  await settle();
  expect(w.findAll("tbody tr")).toHaveLength(1);
});
