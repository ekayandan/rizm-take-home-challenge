import { expect, test } from "vitest";
import { formatInstant, formatRange } from "../src/timestamps";

const BERLIN = "Europe/Berlin";
const NOW = new Date("2026-10-31T12:00:00.000Z");

test("an instant reads in the hall's timezone", () => {
  expect(formatInstant("2026-10-06T06:00:00.000Z", BERLIN, NOW)).toBe("6 Oct, 08:00");
});

test("the year shows only when it is not the current one", () => {
  expect(formatInstant("2025-10-06T06:00:00.000Z", BERLIN, NOW)).toBe("6 Oct 2025, 08:00");
});

test("a range within a day names the day once", () => {
  expect(formatRange("2026-10-06T06:00:00.000Z", "2026-10-06T12:00:00.000Z", BERLIN, NOW)).toBe("6 Oct, 08:00 – 14:00");
});

test("a range over several days names both", () => {
  expect(formatRange("2026-10-06T06:00:00.000Z", "2026-10-07T06:00:00.000Z", BERLIN, NOW)).toBe("6 Oct, 08:00 – 7 Oct, 08:00");
});

test("the repeated hour of the clock change stays distinct", () => {
  expect(formatInstant("2026-10-25T00:30:00.000Z", BERLIN, NOW)).toBe("25 Oct, 02:30 CEST");
  expect(formatInstant("2026-10-25T01:30:00.000Z", BERLIN, NOW)).toBe("25 Oct, 02:30 CET");
  expect(formatRange("2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z", BERLIN, NOW)).toBe("25 Oct, 02:30 CEST – 02:30 CET");
});
