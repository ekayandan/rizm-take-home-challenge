import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Site } from "../src/api";
import { useSitesStore } from "../src/stores/sites";

type Day = { date: string; steps: number };

const site = (...halls: Day[][]) =>
  ({
    id: "s",
    halls: halls.map((days, i) => ({ id: `h${i}`, days })),
  }) as unknown as Site;

const daysOf = (...sites: Site[]) => {
  const store = useSitesStore();
  store.sites = sites;
  return store.days;
};

beforeEach(() => setActivePinia(createPinia()));

describe("site-wide day list", () => {
  test("is empty without sites or without days", () => {
    expect(daysOf()).toEqual([]);
    expect(daysOf(site([], []))).toEqual([]);
  });

  test("lists a day once when halls agree", () => {
    const day = { date: "2026-10-05", steps: 96 };
    expect(daysOf(site([day], [day]))).toEqual([day]);
  });

  test("combines halls with different dates, sorted across sites", () => {
    const days = daysOf(
      site([{ date: "2026-10-07", steps: 96 }]),
      site([{ date: "2026-10-05", steps: 96 }], [{ date: "2026-10-06", steps: 96 }]),
    );
    expect(days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });

  test.each([
    ["first", [100, 96]],
    ["last", [96, 100]],
    ["middle", [96, 100, 96]],
  ])("an unusual count survives when the %s hall has it", (_where, counts) => {
    const days = daysOf(site(...counts.map((steps) => [{ date: "2026-10-25", steps }])));
    expect(days).toEqual([{ date: "2026-10-25", steps: 100 }]);
  });

  test("an unusual count in one site survives a normal count in another", () => {
    const days = daysOf(site([{ date: "2026-10-25", steps: 40 }]), site([{ date: "2026-10-25", steps: 96 }]));
    expect(days).toEqual([{ date: "2026-10-25", steps: 40 }]);
  });

  test("two different unusual counts still give an unusual count", () => {
    const [day] = daysOf(site([{ date: "2026-10-25", steps: 100 }], [{ date: "2026-10-25", steps: 40 }]));
    expect(day.steps).not.toBe(96);
  });
});
