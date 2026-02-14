import { describe, it, expect } from "vitest";
import { parseTime } from "./parse-time.js";

// Fixed reference time: Wednesday 2024-01-17T12:00:00 (local)
const REF_DATE = new Date(2024, 0, 17, 12, 0, 0, 0); // Month is 0-indexed
const NOW = REF_DATE.getTime();

describe("parseTime", () => {
  describe("named constants", () => {
    it("should parse 'now' as the current time", () => {
      expect(parseTime("now", NOW)).toBe(NOW);
    });

    it("should parse 'today' as midnight today", () => {
      const expected = new Date(2024, 0, 17, 0, 0, 0, 0).getTime();
      expect(parseTime("today", NOW)).toBe(expected);
    });

    it("should parse 'yesterday' as midnight yesterday", () => {
      const expected = new Date(2024, 0, 16, 0, 0, 0, 0).getTime();
      expect(parseTime("yesterday", NOW)).toBe(expected);
    });
  });

  describe("relative durations", () => {
    it("should parse seconds", () => {
      expect(parseTime("5s", NOW)).toBe(NOW - 5000);
      expect(parseTime("30s", NOW)).toBe(NOW - 30000);
    });

    it("should parse minutes", () => {
      expect(parseTime("5m", NOW)).toBe(NOW - 5 * 60 * 1000);
      expect(parseTime("10m", NOW)).toBe(NOW - 10 * 60 * 1000);
    });

    it("should parse hours", () => {
      expect(parseTime("2h", NOW)).toBe(NOW - 2 * 60 * 60 * 1000);
    });

    it("should parse days", () => {
      expect(parseTime("3d", NOW)).toBe(NOW - 3 * 24 * 60 * 60 * 1000);
    });

    it("should parse weeks", () => {
      expect(parseTime("1w", NOW)).toBe(NOW - 7 * 24 * 60 * 60 * 1000);
    });

    it("should handle zero duration", () => {
      expect(parseTime("0s", NOW)).toBe(NOW);
      expect(parseTime("0m", NOW)).toBe(NOW);
    });
  });

  describe("day of week", () => {
    // REF_DATE is Wednesday (day 3)
    it("should parse full day names", () => {
      const monday = new Date(2024, 0, 15, 0, 0, 0, 0).getTime();
      expect(parseTime("monday", NOW)).toBe(monday);
    });

    it("should parse abbreviated day names", () => {
      const monday = new Date(2024, 0, 15, 0, 0, 0, 0).getTime();
      expect(parseTime("mon", NOW)).toBe(monday);
    });

    it("should go back 7 days when today is the specified day", () => {
      // Wednesday is today, so it should go back to last Wednesday
      const lastWed = new Date(2024, 0, 10, 0, 0, 0, 0).getTime();
      expect(parseTime("wednesday", NOW)).toBe(lastWed);
      expect(parseTime("wed", NOW)).toBe(lastWed);
    });

    it("should parse case-insensitively", () => {
      const monday = new Date(2024, 0, 15, 0, 0, 0, 0).getTime();
      expect(parseTime("MONDAY", NOW)).toBe(monday);
      expect(parseTime("Monday", NOW)).toBe(monday);
    });

    it("should correctly find most recent past occurrence", () => {
      // Sunday (day 0): from Wednesday, that's 3 days back
      const sunday = new Date(2024, 0, 14, 0, 0, 0, 0).getTime();
      expect(parseTime("sunday", NOW)).toBe(sunday);

      // Thursday (day 4): from Wednesday, go back 6 days
      const thursday = new Date(2024, 0, 11, 0, 0, 0, 0).getTime();
      expect(parseTime("thursday", NOW)).toBe(thursday);
    });
  });

  describe("12-hour time", () => {
    it("should parse morning times", () => {
      const expected = new Date(2024, 0, 17, 10, 0, 0, 0).getTime();
      expect(parseTime("10am", NOW)).toBe(expected);
    });

    it("should parse afternoon times", () => {
      const expected = new Date(2024, 0, 17, 14, 30, 0, 0).getTime();
      expect(parseTime("2:30pm", NOW)).toBe(expected);
    });

    it("should handle 12am as midnight", () => {
      const expected = new Date(2024, 0, 17, 0, 0, 0, 0).getTime();
      expect(parseTime("12am", NOW)).toBe(expected);
    });

    it("should handle 12pm as noon", () => {
      const expected = new Date(2024, 0, 17, 12, 0, 0, 0).getTime();
      expect(parseTime("12pm", NOW)).toBe(expected);
    });

    it("should parse case-insensitively", () => {
      const expected = new Date(2024, 0, 17, 10, 0, 0, 0).getTime();
      expect(parseTime("10AM", NOW)).toBe(expected);
    });

    it("should throw on invalid 12-hour time (0am)", () => {
      expect(() => parseTime("0am", NOW)).toThrow("Invalid 12-hour time");
    });

    it("should throw on invalid 12-hour time (13pm)", () => {
      expect(() => parseTime("13pm", NOW)).toThrow("Invalid 12-hour time");
    });

    it("should throw on invalid 12-hour minutes (10:60am)", () => {
      expect(() => parseTime("10:60am", NOW)).toThrow("Invalid 12-hour time");
    });
  });

  describe("24-hour time", () => {
    it("should parse standard times", () => {
      const expected = new Date(2024, 0, 17, 14, 30, 0, 0).getTime();
      expect(parseTime("14:30", NOW)).toBe(expected);
    });

    it("should parse midnight", () => {
      const expected = new Date(2024, 0, 17, 0, 0, 0, 0).getTime();
      expect(parseTime("0:00", NOW)).toBe(expected);
    });

    it("should parse single-digit hours", () => {
      const expected = new Date(2024, 0, 17, 9, 0, 0, 0).getTime();
      expect(parseTime("9:00", NOW)).toBe(expected);
    });

    it("should throw on invalid 24-hour time (25:00)", () => {
      expect(() => parseTime("25:00", NOW)).toThrow("Invalid 24-hour time");
    });

    it("should throw on invalid 24-hour minutes (14:99)", () => {
      expect(() => parseTime("14:99", NOW)).toThrow("Invalid 24-hour time");
    });
  });

  describe("ISO date", () => {
    it("should parse YYYY-MM-DD as local midnight", () => {
      const expected = new Date(2024, 0, 1, 0, 0, 0, 0).getTime();
      expect(parseTime("2024-01-01", NOW)).toBe(expected);
    });
  });

  describe("ISO datetime", () => {
    it("should parse with T separator", () => {
      const expected = new Date(2024, 0, 1, 10, 0, 0, 0).getTime();
      expect(parseTime("2024-01-01T10:00", NOW)).toBe(expected);
    });

    it("should parse with space separator", () => {
      const expected = new Date(2024, 0, 1, 10, 0, 0, 0).getTime();
      expect(parseTime("2024-01-01 10:00", NOW)).toBe(expected);
    });
  });

  describe("edge cases", () => {
    it("should trim whitespace", () => {
      expect(parseTime("  5m  ", NOW)).toBe(NOW - 5 * 60 * 1000);
    });

    it("should throw on invalid input", () => {
      expect(() => parseTime("not-a-time", NOW)).toThrow("Unrecognised time expression");
    });

    it("should throw on empty string", () => {
      expect(() => parseTime("", NOW)).toThrow("Unrecognised time expression");
    });

    it("should throw with helpful format list", () => {
      try {
        parseTime("gibberish", NOW);
      } catch (e) {
        expect((e as Error).message).toContain("Supported formats:");
        expect((e as Error).message).toContain("Relative:");
        expect((e as Error).message).toContain("Named:");
      }
    });
  });
});
