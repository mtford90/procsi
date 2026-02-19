import { describe, expect, it } from "vitest";
import { buildFilter } from "./requests.js";

describe("buildFilter", () => {
  it("builds plain text search filters", () => {
    expect(buildFilter({ search: "users api" })).toEqual({ search: "users api" });
  });

  it("detects /pattern/ syntax in --search and emits regex", () => {
    expect(buildFilter({ search: "/users\\/\\d+/" })).toEqual({
      regex: "users\\/\\d+",
    });
  });

  it("supports regex flags in /pattern/ literals", () => {
    expect(buildFilter({ search: "/users/i" })).toEqual({
      regex: "users",
      regexFlags: "i",
    });
  });

  it("builds regex filters from --regex", () => {
    expect(buildFilter({ regex: "users/\\d+" })).toEqual({
      regex: "users/\\d+",
    });
  });

  it("throws when both --search and --regex are provided", () => {
    expect(() => buildFilter({ search: "users", regex: "users" })).toThrow(
      "Cannot combine --search and --regex"
    );
  });

  it("throws on invalid regex in --search /pattern/", () => {
    expect(() => buildFilter({ search: "/users([/" })).toThrow('Invalid regex pattern "users(["');
  });

  it("throws on invalid regex in --regex", () => {
    expect(() => buildFilter({ regex: "users([" })).toThrow('Invalid regex pattern "users(["');
  });
});
