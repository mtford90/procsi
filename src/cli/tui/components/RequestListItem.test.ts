/**
 * Tests for RequestListItem utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  getMethodColour,
  getStatusColour,
  getStatusIndicator,
  getInterceptionIndicator,
  getReplayIndicator,
} from "./RequestListItem.js";

describe("getMethodColour", () => {
  it("returns green for GET", () => {
    expect(getMethodColour("GET")).toBe("green");
  });

  it("returns blue for POST", () => {
    expect(getMethodColour("POST")).toBe("blue");
  });

  it("returns yellow for PUT", () => {
    expect(getMethodColour("PUT")).toBe("yellow");
  });

  it("returns yellow for PATCH", () => {
    expect(getMethodColour("PATCH")).toBe("yellow");
  });

  it("returns magenta for DELETE", () => {
    expect(getMethodColour("DELETE")).toBe("magenta");
  });

  it("returns white for unknown methods", () => {
    expect(getMethodColour("OPTIONS")).toBe("white");
    expect(getMethodColour("HEAD")).toBe("white");
  });

  it("is case-insensitive", () => {
    expect(getMethodColour("get")).toBe("green");
    expect(getMethodColour("Post")).toBe("blue");
    expect(getMethodColour("delete")).toBe("magenta");
  });
});

describe("getStatusColour", () => {
  it("returns gray for undefined", () => {
    expect(getStatusColour(undefined)).toBe("gray");
  });

  it("returns green for 2xx", () => {
    expect(getStatusColour(200)).toBe("green");
    expect(getStatusColour(201)).toBe("green");
    expect(getStatusColour(204)).toBe("green");
    expect(getStatusColour(299)).toBe("green");
  });

  it("returns yellow for 3xx", () => {
    expect(getStatusColour(300)).toBe("yellow");
    expect(getStatusColour(301)).toBe("yellow");
    expect(getStatusColour(304)).toBe("yellow");
    expect(getStatusColour(399)).toBe("yellow");
  });

  it("returns red for 4xx", () => {
    expect(getStatusColour(400)).toBe("red");
    expect(getStatusColour(404)).toBe("red");
    expect(getStatusColour(422)).toBe("red");
    expect(getStatusColour(499)).toBe("red");
  });

  it("returns red for 5xx", () => {
    expect(getStatusColour(500)).toBe("red");
    expect(getStatusColour(502)).toBe("red");
    expect(getStatusColour(503)).toBe("red");
  });

  it("returns white for 1xx informational codes", () => {
    expect(getStatusColour(100)).toBe("white");
    expect(getStatusColour(101)).toBe("white");
  });
});

describe("getInterceptionIndicator", () => {
  it("returns M with magenta for mocked requests", () => {
    const result = getInterceptionIndicator("mocked");
    expect(result.text).toBe("M ");
    expect(result.colour).toBe("magenta");
  });

  it("returns I with cyan for modified requests", () => {
    const result = getInterceptionIndicator("modified");
    expect(result.text).toBe("I ");
    expect(result.colour).toBe("cyan");
  });

  it("returns empty indicator for normal requests (undefined)", () => {
    const result = getInterceptionIndicator(undefined);
    expect(result.text).toBe("  ");
    expect(result.colour).toBeUndefined();
  });
});

describe("getReplayIndicator", () => {
  it("returns R with yellow for replayed requests", () => {
    const result = getReplayIndicator("abc123");
    expect(result.text).toBe("R ");
    expect(result.colour).toBe("yellow");
  });

  it("returns empty indicator for non-replayed requests", () => {
    const result = getReplayIndicator(undefined);
    expect(result.text).toBe("  ");
    expect(result.colour).toBeUndefined();
  });
});

describe("getStatusIndicator", () => {
  it("returns space for undefined", () => {
    expect(getStatusIndicator(undefined)).toBe(" ");
  });

  it("returns ✓ for 2xx", () => {
    expect(getStatusIndicator(200)).toBe("✓");
    expect(getStatusIndicator(201)).toBe("✓");
    expect(getStatusIndicator(204)).toBe("✓");
    expect(getStatusIndicator(299)).toBe("✓");
  });

  it("returns → for 3xx", () => {
    expect(getStatusIndicator(300)).toBe("→");
    expect(getStatusIndicator(301)).toBe("→");
    expect(getStatusIndicator(304)).toBe("→");
    expect(getStatusIndicator(399)).toBe("→");
  });

  it("returns ✗ for 4xx", () => {
    expect(getStatusIndicator(400)).toBe("✗");
    expect(getStatusIndicator(404)).toBe("✗");
    expect(getStatusIndicator(499)).toBe("✗");
  });

  it("returns ✗ for 5xx", () => {
    expect(getStatusIndicator(500)).toBe("✗");
    expect(getStatusIndicator(502)).toBe("✗");
    expect(getStatusIndicator(503)).toBe("✗");
  });

  it("returns ✗ for 1xx informational codes", () => {
    expect(getStatusIndicator(100)).toBe("✗");
  });
});
