import { describe, expect, it } from "vitest";
import {
  normaliseRegexFilterInput,
  parseRegexLiteral,
  parseUrlSearchInput,
  validateRegexFilter,
} from "./regex-filter.js";

describe("validateRegexFilter", () => {
  it("accepts a valid pattern without flags", () => {
    expect(validateRegexFilter("users/\\d+")).toEqual({
      pattern: "users/\\d+",
      flags: "",
    });
  });

  it("accepts valid flags", () => {
    expect(validateRegexFilter("users", "im")).toEqual({ pattern: "users", flags: "im" });
  });

  it("throws on invalid patterns", () => {
    expect(() => validateRegexFilter("users([")).toThrow('Invalid regex pattern "users(["');
  });

  it("throws on duplicate flags", () => {
    expect(() => validateRegexFilter("users", "ii")).toThrow('Duplicate regex flag "i".');
  });

  it("throws on unsupported flags", () => {
    expect(() => validateRegexFilter("users", "z")).toThrow('Unsupported regex flag "z".');
  });

  it("rejects patterns with catastrophic backtracking", () => {
    expect(() => validateRegexFilter("(a+)+$")).toThrow("potential catastrophic backtracking");
  });
});

describe("parseRegexLiteral", () => {
  it("parses slash-delimited literals", () => {
    expect(parseRegexLiteral("/users\\/\\d+/")).toEqual({
      pattern: "users\\/\\d+",
      flags: "",
    });
  });

  it("parses literals with flags", () => {
    expect(parseRegexLiteral("/users/i")).toEqual({ pattern: "users", flags: "i" });
  });

  it("returns undefined for plain text", () => {
    expect(parseRegexLiteral("users")).toBeUndefined();
  });

  it("throws for invalid regex literals", () => {
    expect(() => parseRegexLiteral("/users([/")).toThrow('Invalid regex pattern "users(["');
  });
});

describe("parseUrlSearchInput", () => {
  it("returns plain search for non-regex input", () => {
    expect(parseUrlSearchInput(" users api ")).toEqual({ search: "users api" });
  });

  it("returns regex when slash syntax is used", () => {
    expect(parseUrlSearchInput("/users\\/\\d+/")).toEqual({
      regex: { pattern: "users\\/\\d+", flags: "" },
    });
  });

  it("returns empty object for blank input", () => {
    expect(parseUrlSearchInput("   ")).toEqual({});
  });
});

describe("normaliseRegexFilterInput", () => {
  it("treats raw patterns as regex patterns", () => {
    expect(normaliseRegexFilterInput("users/\\d+")).toEqual({
      pattern: "users/\\d+",
      flags: "",
    });
  });

  it("parses slash literals when flags are not provided", () => {
    expect(normaliseRegexFilterInput("/users/i")).toEqual({ pattern: "users", flags: "i" });
  });

  it("uses explicit flags when provided", () => {
    expect(normaliseRegexFilterInput("users", "i")).toEqual({ pattern: "users", flags: "i" });
  });
});
