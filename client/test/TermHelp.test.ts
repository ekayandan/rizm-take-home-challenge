import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import TermHelp, { placeTooltip } from "../src/components/TermHelp.vue";
import { GLOSSARY } from "../src/glossary";

let wrapper: VueWrapper<any>;

function help() {
  wrapper = mount(TermHelp, { props: { term: "massFlow" }, slots: { default: "Fan kg/s" }, attachTo: document.body });
  return wrapper.get("button");
}
const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]');

afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});

describe("TermHelp", () => {
  test("shows the term with a named button and no text until asked", () => {
    const button = help();
    expect(wrapper.text()).toContain("Fan kg/s");
    expect(button.attributes("aria-label")).toBe("What is Mass flow?");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(tip()).toBeNull();
  });

  test("keyboard focus opens it, links it to the button, and blur closes it", async () => {
    const button = help();
    await button.trigger("focus");
    expect(tip()?.textContent).toContain(GLOSSARY.massFlow.text);
    expect(button.attributes("aria-describedby")).toBe(tip()?.id);
    await button.trigger("blur");
    expect(tip()).toBeNull();
    expect(button.attributes("aria-describedby")).toBeUndefined();
  });

  test("Escape closes it without moving focus", async () => {
    const button = help();
    (button.element as HTMLElement).focus();
    await button.trigger("focus");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(tip()).toBeNull();
    expect(document.activeElement).toBe(button.element);
  });

  test("a tap opens it, and a tap elsewhere closes it", async () => {
    const button = help();
    await button.trigger("click");
    expect(tip()).not.toBeNull();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(tip()).toBeNull();
  });

  test("a tap on the text itself leaves it open", async () => {
    const button = help();
    await button.trigger("click");
    tip()!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(tip()).not.toBeNull();
  });

  test("the pointer can cross from the button to the text", async () => {
    vi.useFakeTimers();
    const button = help();
    await button.trigger("pointerenter");
    await button.trigger("pointerleave");
    tip()!.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(tip()).not.toBeNull();
    tip()!.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(tip()).toBeNull();
  });

  test("scrolling moves it with the button, because tabbing to an off-screen button scrolls", async () => {
    const button = help();
    await button.trigger("focus");
    await nextTick();
    const rect = { left: 40, top: 200, width: 24, height: 24 } as DOMRect;
    vi.spyOn(button.element, "getBoundingClientRect").mockReturnValue(rect);
    window.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(tip()?.style.top).toBe("230px");
    expect(tip()?.style.left).toBe("40px");
  });

  test("stops following the page once closed", async () => {
    const button = help();
    await button.trigger("focus");
    await button.trigger("blur");
    const spy = vi.spyOn(button.element, "getBoundingClientRect");
    window.dispatchEvent(new Event("scroll"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("placeTooltip", () => {
  const viewport = { width: 1024, height: 768 };
  const size = { width: 300, height: 100 };
  const anchor = (left: number, top: number) => ({ left, top, width: 24, height: 24 });

  test("goes below the anchor when it fits", () => {
    expect(placeTooltip(anchor(100, 100), size, viewport)).toEqual({ left: 100, top: 130 });
  });

  test("flips above at the bottom of the screen", () => {
    expect(placeTooltip(anchor(100, 700), size, viewport).top).toBe(594);
  });

  test("stays below when it fits on neither side", () => {
    expect(placeTooltip(anchor(100, 50), { width: 300, height: 760 }, viewport).top).toBe(80);
  });

  test("stays inside the right and left edges", () => {
    expect(placeTooltip(anchor(1000, 100), size, viewport).left).toBe(716);
    expect(placeTooltip(anchor(0, 100), size, { width: 200, height: 768 }).left).toBe(8);
  });
});

describe("glossary", () => {
  test("every entry has a title and an explanation", () => {
    for (const entry of Object.values(GLOSSARY)) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.text.length).toBeGreaterThan(20);
    }
  });
});
