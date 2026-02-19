import { describe, it, expect } from "vitest";
import { isFilterActive } from "./filters.js";

describe("isFilterActive", () => {
  it("returns false for empty filter", () => {
    expect(isFilterActive({})).toBe(false);
  });

  it("returns false for explicitly empty fields", () => {
    expect(isFilterActive({ methods: [], search: "" })).toBe(false);
  });

  it("returns true when methods are set", () => {
    expect(isFilterActive({ methods: ["GET"] })).toBe(true);
  });

  it("returns true when multiple methods are set", () => {
    expect(isFilterActive({ methods: ["GET", "POST"] })).toBe(true);
  });

  it("returns true when statusRange is set", () => {
    expect(isFilterActive({ statusRange: "2xx" })).toBe(true);
  });

  it("returns true when search is set", () => {
    expect(isFilterActive({ search: "api" })).toBe(true);
  });

  it("returns true when regex is set", () => {
    expect(isFilterActive({ regex: "users/\\d+" })).toBe(true);
  });

  it("returns true when all fields are set", () => {
    expect(isFilterActive({ methods: ["GET"], statusRange: "4xx", search: "error" })).toBe(true);
  });

  it("returns false when methods is empty array and others are undefined", () => {
    expect(isFilterActive({ methods: [] })).toBe(false);
  });

  it("returns false when search is empty string and others are undefined", () => {
    expect(isFilterActive({ search: "" })).toBe(false);
  });

  it("returns false when regex is empty string and others are undefined", () => {
    expect(isFilterActive({ regex: "" })).toBe(false);
  });
});
