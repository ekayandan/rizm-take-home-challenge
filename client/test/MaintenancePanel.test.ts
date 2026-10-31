import { beforeEach, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { api, type MaintenanceWindow, type Role } from "../src/api";
import MaintenancePanel from "../src/components/MaintenancePanel.vue";
import { useAuthStore } from "../src/stores/auth";

const saved: MaintenanceWindow = {
  id: 1,
  hall_id: "halle-3",
  asset: "fan",
  start_utc: "2026-10-06T04:00:00.000Z",
  end_utc: "2026-10-06T12:00:00.000Z",
  start_local: "2026-10-06T06:00+02:00",
  end_local: "2026-10-06T14:00+02:00",
  reason: "Belt change",
  created_by: "lena",
  created_by_name: "Lena Hartmann",
  created_at: "2026-10-05T10:00:00.000Z",
};

async function panel(role: Role) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = { id: "u", name: "U", email: "u@example.com", role, sites: ["nordwerk"] };
  const wrapper = mount(MaintenancePanel, {
    props: { hallId: "halle-3", date: "2026-10-06", timezone: "Europe/Berlin" },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "maintenance").mockResolvedValue([]);
});

test("the form cannot be submitted without a reason", async () => {
  const add = vi.spyOn(api, "addMaintenance");
  const wrapper = await panel("operator");
  const button = wrapper.get("button[type=submit]");
  expect(button.attributes("disabled")).toBeDefined();

  await wrapper.get("input[name=reason]").setValue("   ");
  expect(button.attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(add).not.toHaveBeenCalled();

  await wrapper.get("input[name=reason]").setValue("Belt change");
  expect(button.attributes("disabled")).toBeUndefined();
});

test("submitting sends the reason, clears it and lists the new window", async () => {
  const add = vi.spyOn(api, "addMaintenance").mockResolvedValue(saved);
  const wrapper = await panel("operator");
  vi.spyOn(api, "maintenance").mockResolvedValue([saved]);

  await wrapper.get("input[name=reason]").setValue("Belt change");
  await wrapper.get("form").trigger("submit");
  await flushPromises();

  expect(add).toHaveBeenCalledWith("halle-3", { asset: "fan", start: "2026-10-06T06:00", end: "2026-10-06T14:00", reason: "Belt change" });
  expect((wrapper.get("input[name=reason]").element as HTMLInputElement).value).toBe("");
  expect(wrapper.get("tbody").text()).toContain("Belt change");
  expect(wrapper.get("tbody").text()).toContain("Lena Hartmann");
});

test("a failed save keeps the reason and shows the error", async () => {
  vi.spyOn(api, "addMaintenance").mockRejectedValue(new Error("nope"));
  const wrapper = await panel("operator");
  await wrapper.get("input[name=reason]").setValue("Belt change");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toBe("nope");
  expect((wrapper.get("input[name=reason]").element as HTMLInputElement).value).toBe("Belt change");
});

test("a viewer gets no form", async () => {
  const wrapper = await panel("viewer");
  expect(wrapper.find("form").exists()).toBe(false);
});
