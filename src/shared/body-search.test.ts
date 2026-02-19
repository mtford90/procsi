import { describe, expect, it } from "vitest";
import { BODY_SEARCH_TARGETS, parseBodyScopeInput, parseBodySearchTarget } from "./body-search.js";

describe("parseBodySearchTarget", () => {
  it("parses full target names", () => {
    expect(parseBodySearchTarget("request")).toBe("request");
    expect(parseBodySearchTarget("response")).toBe("response");
    expect(parseBodySearchTarget("both")).toBe("both");
  });

  it("parses short aliases", () => {
    expect(parseBodySearchTarget("req")).toBe("request");
    expect(parseBodySearchTarget("res")).toBe("response");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseBodySearchTarget(" Request ")).toBe("request");
    expect(parseBodySearchTarget(" RES ")).toBe("response");
  });

  it("returns undefined for unsupported targets", () => {
    expect(parseBodySearchTarget("headers")).toBeUndefined();
    expect(parseBodySearchTarget("")).toBeUndefined();
  });
});

describe("parseBodyScopeInput", () => {
  it("parses body scope with default target=both", () => {
    expect(parseBodyScopeInput("body:error")).toEqual({
      query: "error",
      target: "both",
    });
  });

  it("parses explicit request target", () => {
    expect(parseBodyScopeInput("body:req:error")).toEqual({
      query: "error",
      target: "request",
    });

    expect(parseBodyScopeInput("body:request:error")).toEqual({
      query: "error",
      target: "request",
    });
  });

  it("parses explicit response target", () => {
    expect(parseBodyScopeInput("body:res:error")).toEqual({
      query: "error",
      target: "response",
    });

    expect(parseBodyScopeInput("body:response:error")).toEqual({
      query: "error",
      target: "response",
    });
  });

  it("keeps text as query when second segment is not a valid target", () => {
    expect(parseBodyScopeInput("body:timeout:downstream")).toEqual({
      query: "timeout:downstream",
      target: "both",
    });
  });

  it("returns undefined for non-body searches", () => {
    expect(parseBodyScopeInput("users api")).toBeUndefined();
  });

  it("returns undefined for incomplete body scopes", () => {
    expect(parseBodyScopeInput("body:")).toBeUndefined();
    expect(parseBodyScopeInput("body:req:")).toBeUndefined();
  });
});

describe("BODY_SEARCH_TARGETS", () => {
  it("enumerates supported canonical targets", () => {
    expect(BODY_SEARCH_TARGETS).toEqual(["request", "response", "both"]);
  });
});
