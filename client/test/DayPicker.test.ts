import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import DayPicker from "../src/components/DayPicker.vue";

type Day = { date: string; steps: number };

const range = (month: string, from: number, to: number, steps = 96): Day[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date: `${month}-${String(from + i).padStart(2, "0")}`, steps }));

let wrapper: VueWrapper<any>;

function picker(modelValue: string, days: Day[]) {
  wrapper = mount(DayPicker, { props: { modelValue, days }, attachTo: document.body });
  return wrapper;
}

const toggle = () => wrapper.get(".day-picker-toggle");
const open = async () => {
  await toggle().trigger("click");
  await nextTick();
};
const isOpen = () => wrapper.find(".day-picker-popup").exists();
const cell = (date: string) => wrapper.get(`[data-date="${date}"]`);
const heading = () => wrapper.get(".day-picker-head strong").text();
const prevMonth = () => wrapper.get('[aria-label="Previous month"]');
const nextMonth = () => wrapper.get('[aria-label="Next month"]');
const focusedDate = () => (document.activeElement as HTMLElement | null)?.dataset.date;
const press = async (key: string) => {
  await wrapper.get(".day-picker").trigger("keydown", { key });
  await nextTick();
};

afterEach(() => wrapper.unmount());

describe("calendar grid", () => {
  test("weeks start on Monday", async () => {
    picker("2026-10-05", range("2026-10", 5, 31)); // 1 October 2026 is a Thursday
    await open();
    const grid = [...wrapper.get(".day-picker-grid").element.children];
    expect(grid.slice(0, 7).map((c) => c.textContent)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    expect(grid.slice(7, 10).every((c) => c.tagName === "SPAN" && !c.textContent)).toBe(true);
    expect((grid[10] as HTMLElement).dataset.date).toBe("2026-10-01");
  });

  test("a month starting on Monday has no blank cells", async () => {
    picker("2026-06-01", range("2026-06", 1, 30));
    await open();
    expect((wrapper.get(".day-picker-grid").element.children[7] as HTMLElement).dataset.date).toBe("2026-06-01");
  });

  test("a month starting on Sunday has six blank cells", async () => {
    picker("2026-11-01", range("2026-11", 1, 30));
    await open();
    expect((wrapper.get(".day-picker-grid").element.children[13] as HTMLElement).dataset.date).toBe("2026-11-01");
  });

  test.each([
    ["2028-02", 29],
    ["2026-02", 28],
    ["2026-04", 30],
    ["2026-12", 31],
  ])("%s has %i days", async (month, length) => {
    picker(`${month}-01`, range(month, 1, 1));
    await open();
    expect(wrapper.findAll(".day")).toHaveLength(length);
  });

  test("the clock-change day is one cell, not split by the time zone", async () => {
    picker("2026-10-25", range("2026-10", 24, 26));
    await open();
    expect(wrapper.findAll('[data-date="2026-10-25"]')).toHaveLength(1);
    expect(wrapper.findAll(".day")).toHaveLength(31);
  });
});

describe("opening and picking", () => {
  test("opens on the selected day's month with focus on that day", async () => {
    picker("2026-11-02", [...range("2026-10", 30, 31), ...range("2026-11", 1, 3)]);
    await open();
    expect(heading()).toBe("November 2026");
    expect(focusedDate()).toBe("2026-11-02");
  });

  test("picking emits the date, closes and returns focus to the button", async () => {
    picker("2026-10-05", range("2026-10", 5, 10));
    await open();
    await cell("2026-10-07").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["2026-10-07"]]);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle().element);
  });

  test("the button follows the selected day", async () => {
    picker("2026-10-05", range("2026-10", 5, 10));
    await wrapper.setProps({ modelValue: "2026-10-06" });
    expect(toggle().text()).toContain("2026-10-06");
    expect(toggle().attributes("aria-label")).toBe("Day: 2026-10-06, 96 steps");
  });

  test("clicking the button again closes", async () => {
    picker("2026-10-05", range("2026-10", 5, 10));
    await open();
    await open();
    expect(isOpen()).toBe(false);
  });

  test("a click outside closes without picking; a click inside does not", async () => {
    picker("2026-10-05", range("2026-10", 5, 10));
    await open();
    wrapper.get(".day-picker-head").element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(isOpen()).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(isOpen()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  test("removes its document listener when unmounted", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    picker("2026-10-05", range("2026-10", 5, 6));
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    remove.mockRestore();
    picker("2026-10-05", range("2026-10", 5, 6)); // for afterEach
  });
});

describe("month navigation", () => {
  test("stops at the first and last month with data", async () => {
    picker("2026-10-31", [...range("2026-10", 30, 31), ...range("2026-11", 1, 2)]);
    await open();
    expect(prevMonth().attributes("disabled")).toBeDefined();
    expect(nextMonth().attributes("disabled")).toBeUndefined();
    await nextMonth().trigger("click");
    expect(heading()).toBe("November 2026");
    expect(nextMonth().attributes("disabled")).toBeDefined();
    expect(prevMonth().attributes("disabled")).toBeUndefined();
  });

  test("crosses the year boundary in both directions", async () => {
    picker("2026-12-31", [...range("2026-12", 31, 31), ...range("2027-01", 1, 1)]);
    await open();
    await nextMonth().trigger("click");
    expect(heading()).toBe("January 2027");
    await prevMonth().trigger("click");
    expect(heading()).toBe("December 2026");
  });

  test("single-month data disables both arrows", async () => {
    picker("2026-10-05", range("2026-10", 5, 6));
    await open();
    expect(prevMonth().attributes("disabled")).toBeDefined();
    expect(nextMonth().attributes("disabled")).toBeDefined();
  });

  test("after changing month one day with data can be reached with Tab", async () => {
    picker("2026-10-31", [...range("2026-10", 30, 31), ...range("2026-11", 3, 4)]);
    await open();
    await nextMonth().trigger("click");
    const reachable = wrapper.findAll('.day[tabindex="0"]');
    expect(reachable.map((d) => d.attributes("data-date"))).toEqual(["2026-11-03"]);
  });

  test("a month with no data between two others can still be passed", async () => {
    picker("2026-10-31", [...range("2026-10", 31, 31), ...range("2026-12", 1, 1)]);
    await open();
    await nextMonth().trigger("click");
    expect(heading()).toBe("November 2026");
    expect(wrapper.findAll(".day:not([disabled])")).toHaveLength(0);
    await nextMonth().trigger("click");
    expect(heading()).toBe("December 2026");
  });
});

describe("keyboard", () => {
  test("left and right move one day and cross months", async () => {
    picker("2026-10-31", [...range("2026-10", 30, 31), ...range("2026-11", 1, 2)]);
    await open();
    await press("ArrowRight");
    expect(focusedDate()).toBe("2026-11-01");
    expect(heading()).toBe("November 2026");
    await press("ArrowLeft");
    expect(focusedDate()).toBe("2026-10-31");
    expect(heading()).toBe("October 2026");
  });

  test("up and down keep the weekday", async () => {
    picker("2026-10-14", range("2026-10", 5, 31));
    await open();
    await press("ArrowDown");
    expect(focusedDate()).toBe("2026-10-21");
    await press("ArrowUp");
    expect(focusedDate()).toBe("2026-10-14");
  });

  test("up and down stay put when the target has no data", async () => {
    picker("2026-10-07", range("2026-10", 5, 10));
    await open();
    await press("ArrowUp");
    expect(focusedDate()).toBe("2026-10-07");
    await press("ArrowDown");
    expect(focusedDate()).toBe("2026-10-07");
  });

  test("up and down are exact over the clock change", async () => {
    picker("2026-10-22", range("2026-10", 5, 31));
    await open();
    await press("ArrowDown");
    expect(focusedDate()).toBe("2026-10-29");
  });

  test("left and right skip a gap in the data", async () => {
    picker("2026-10-09", [...range("2026-10", 5, 9), ...range("2026-10", 15, 20)]);
    await open();
    await press("ArrowRight");
    expect(focusedDate()).toBe("2026-10-15");
    await press("ArrowLeft");
    expect(focusedDate()).toBe("2026-10-09");
  });

  test("left and right stop at the ends of the data", async () => {
    picker("2026-10-05", range("2026-10", 5, 5));
    await open();
    await press("ArrowLeft");
    expect(focusedDate()).toBe("2026-10-05");
    await press("ArrowRight");
    expect(focusedDate()).toBe("2026-10-05");
  });

  test("escape closes without picking and returns focus", async () => {
    picker("2026-10-05", range("2026-10", 5, 10));
    await open();
    await press("Escape");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle().element);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  test("arrow keys are left alone while the calendar is closed", async () => {
    picker("2026-10-07", range("2026-10", 5, 10));
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    await open();
    await press("Escape");
    toggle().element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("only one day is a tab stop", async () => {
    picker("2026-10-07", range("2026-10", 5, 10));
    await open();
    expect(wrapper.findAll('.day[tabindex="0"]').map((d) => d.attributes("data-date"))).toEqual(["2026-10-07"]);
  });
});

describe("missing data", () => {
  test("days without data are disabled and cannot be picked", async () => {
    picker("2026-10-09", [...range("2026-10", 5, 9), ...range("2026-10", 15, 20)]);
    await open();
    const gap = cell("2026-10-12");
    expect(gap.attributes("disabled")).toBeDefined();
    expect(gap.attributes("aria-label")).toBe("2026-10-12, no data");
    expect(gap.text()).toContain("–");
    expect(gap.find(".step-icon").exists()).toBe(false);
    (wrapper.vm as any).$.setupState.pick("2026-10-12");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(isOpen()).toBe(true);
  });

  test("days outside the data range are disabled", async () => {
    picker("2026-10-05", range("2026-10", 5, 6));
    await open();
    expect(cell("2026-10-04").attributes("disabled")).toBeDefined();
    expect(cell("2026-10-07").attributes("disabled")).toBeDefined();
  });

  test("a selected day without data says so and opens on the latest day", async () => {
    picker("2027-01-01", range("2026-10", 5, 10));
    expect(toggle().text()).toContain("no data");
    expect(toggle().attributes("aria-label")).toBe("Day: 2027-01-01, no data");
    await open();
    expect(heading()).toBe("October 2026");
    expect(focusedDate()).toBe("2026-10-10");
  });

  test("no selected day asks for one", () => {
    picker("", range("2026-10", 5, 6));
    expect(toggle().text()).toBe("Pick a day");
    expect(toggle().attributes("aria-label")).toBe("Day");
  });

  test("a hall with no days cannot open an empty calendar", async () => {
    picker("", []);
    expect(toggle().text()).toBe("No days with data");
    expect(toggle().attributes("disabled")).toBeDefined();
    await open();
    expect(isOpen()).toBe(false);
  });

  test("a date from the URL on a hall with no days cannot open an empty calendar", async () => {
    picker("2026-10-05", []);
    expect(toggle().text()).toContain("no data");
    expect(toggle().attributes("disabled")).toBeDefined();
    await open();
    expect(isOpen()).toBe(false);
  });

  test("data arriving later is picked up", async () => {
    picker("2026-10-05", []);
    expect(toggle().text()).toContain("no data");
    await wrapper.setProps({ days: range("2026-10", 5, 6) });
    expect(toggle().text()).toContain("96");
    await open();
    expect(cell("2026-10-06").attributes("disabled")).toBeUndefined();
  });
});

describe("step counts and highlighting", () => {
  const unusual = () => wrapper.findAll(".day.unusual").map((d) => d.attributes("data-date"));

  test.each([
    ["autumn clock change", 100],
    ["spring clock change", 92],
    ["partial day", 40],
    ["single step", 1],
    ["one over", 97],
    ["one under", 95],
  ])("%s (%i steps) is highlighted", async (_name, steps) => {
    picker("2026-10-05", [{ date: "2026-10-05", steps: 96 }, { date: "2026-10-06", steps }]);
    await open();
    expect(unusual()).toEqual(["2026-10-06"]);
    expect(cell("2026-10-06").text()).toContain(String(steps));
    expect(cell("2026-10-06").attributes("aria-label")).toBe(`2026-10-06, ${steps} steps`);
  });

  test("a normal month has no highlights", async () => {
    picker("2026-10-05", range("2026-10", 5, 31));
    await open();
    expect(unusual()).toEqual([]);
  });

  test("days without data are not highlighted", async () => {
    picker("2026-10-05", [{ date: "2026-10-05", steps: 96 }, { date: "2026-10-09", steps: 96 }]);
    await open();
    expect(cell("2026-10-07").classes()).not.toContain("unusual");
  });

  test("a selected unusual day keeps both states", async () => {
    picker("2026-10-25", [{ date: "2026-10-25", steps: 100 }]);
    await open();
    expect(cell("2026-10-25").classes()).toEqual(expect.arrayContaining(["selected", "unusual"]));
    expect(cell("2026-10-25").attributes("aria-current")).toBe("date");
  });

  test("every day with data shows the step icon and its words stay for assistive tech", async () => {
    picker("2026-10-05", range("2026-10", 5, 6));
    await open();
    expect(cell("2026-10-05").find(".step-icon").attributes("aria-hidden")).toBe("true");
    expect(cell("2026-10-05").attributes("title")).toBe("2026-10-05, 96 steps");
    expect(cell("2026-10-05").text()).not.toContain("steps");
  });
});
