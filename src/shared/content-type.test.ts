import { describe, it, expect } from "vitest";
import {
  isTextContentType,
  isJsonContentType,
  normaliseContentType,
  buildTextContentTypeSqlCondition,
  buildJsonContentTypeSqlCondition,
  TEXT_CONTENT_TYPES,
  TEXT_SUFFIXES,
  JSON_CONTENT_TYPES,
  JSON_SUFFIX,
} from "./content-type.js";

describe("normaliseContentType", () => {
  it("strips charset parameter", () => {
    expect(normaliseContentType("application/json; charset=utf-8")).toBe("application/json");
  });

  it("strips multiple parameters", () => {
    expect(normaliseContentType("text/html; charset=utf-8; boundary=something")).toBe("text/html");
  });

  it("lowercases the content type", () => {
    expect(normaliseContentType("Application/JSON")).toBe("application/json");
    expect(normaliseContentType("TEXT/HTML")).toBe("text/html");
    expect(normaliseContentType("Image/PNG")).toBe("image/png");
  });

  it("trims whitespace", () => {
    expect(normaliseContentType("  text/html  ")).toBe("text/html");
    expect(normaliseContentType("application/json ")).toBe("application/json");
    expect(normaliseContentType(" text/plain")).toBe("text/plain");
  });

  it("returns null for undefined", () => {
    expect(normaliseContentType(undefined)).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(normaliseContentType("")).toBe(null);
  });

  it("returns null for whitespace-only string", () => {
    expect(normaliseContentType("   ")).toBe(null);
  });

  it("handles content type with only semicolon", () => {
    expect(normaliseContentType(";")).toBe(null);
    expect(normaliseContentType("; charset=utf-8")).toBe(null);
  });

  it("preserves valid content type without parameters", () => {
    expect(normaliseContentType("application/json")).toBe("application/json");
    expect(normaliseContentType("text/html")).toBe("text/html");
  });
});

describe("isTextContentType", () => {
  describe("standard text types", () => {
    it("detects application/json as text", () => {
      expect(isTextContentType("application/json")).toBe(true);
    });

    it("detects text/html as text", () => {
      expect(isTextContentType("text/html")).toBe(true);
    });

    it("detects text/plain as text", () => {
      expect(isTextContentType("text/plain")).toBe(true);
    });

    it("detects application/xml as text", () => {
      expect(isTextContentType("application/xml")).toBe(true);
    });

    it("detects application/javascript as text", () => {
      expect(isTextContentType("application/javascript")).toBe(true);
    });

    it("detects application/x-www-form-urlencoded as text", () => {
      expect(isTextContentType("application/x-www-form-urlencoded")).toBe(true);
    });

    it("detects application/xhtml+xml as text", () => {
      expect(isTextContentType("application/xhtml+xml")).toBe(true);
    });

    it("detects application/ld+json as text", () => {
      expect(isTextContentType("application/ld+json")).toBe(true);
    });

    it("detects application/manifest+json as text", () => {
      expect(isTextContentType("application/manifest+json")).toBe(true);
    });

    it("detects application/x-javascript as text", () => {
      expect(isTextContentType("application/x-javascript")).toBe(true);
    });
  });

  describe("text/* prefix matching", () => {
    it("detects text/css as text", () => {
      expect(isTextContentType("text/css")).toBe(true);
    });

    it("detects text/csv as text", () => {
      expect(isTextContentType("text/csv")).toBe(true);
    });

    it("detects text/markdown as text", () => {
      expect(isTextContentType("text/markdown")).toBe(true);
    });

    it("detects arbitrary text/* subtypes as text", () => {
      expect(isTextContentType("text/calendar")).toBe(true);
      expect(isTextContentType("text/whatever")).toBe(true);
    });
  });

  describe("suffix matching", () => {
    it("detects types with +json suffix as text", () => {
      expect(isTextContentType("application/hal+json")).toBe(true);
      expect(isTextContentType("application/vnd.api+json")).toBe(true);
      expect(isTextContentType("application/problem+json")).toBe(true);
    });

    it("detects types with +xml suffix as text", () => {
      expect(isTextContentType("application/soap+xml")).toBe(true);
      expect(isTextContentType("application/atom+xml")).toBe(true);
      expect(isTextContentType("application/rss+xml")).toBe(true);
    });

    it("detects types with +html suffix as text", () => {
      expect(isTextContentType("application/something+html")).toBe(true);
    });

    it("detects types with +text suffix as text", () => {
      expect(isTextContentType("application/something+text")).toBe(true);
      expect(isTextContentType("text/something+text")).toBe(true);
    });
  });

  describe("binary types", () => {
    it("detects image/png as binary", () => {
      expect(isTextContentType("image/png")).toBe(false);
    });

    it("detects application/octet-stream as binary", () => {
      expect(isTextContentType("application/octet-stream")).toBe(false);
    });

    it("detects video/mp4 as binary", () => {
      expect(isTextContentType("video/mp4")).toBe(false);
    });

    it("detects audio/mpeg as binary", () => {
      expect(isTextContentType("audio/mpeg")).toBe(false);
    });

    it("detects image/jpeg as binary", () => {
      expect(isTextContentType("image/jpeg")).toBe(false);
    });

    it("detects application/pdf as binary", () => {
      expect(isTextContentType("application/pdf")).toBe(false);
    });

    it("detects application/zip as binary", () => {
      expect(isTextContentType("application/zip")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for undefined", () => {
      expect(isTextContentType(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isTextContentType("")).toBe(false);
    });

    it("handles content type with charset parameter", () => {
      expect(isTextContentType("application/json; charset=utf-8")).toBe(true);
      expect(isTextContentType("text/html; charset=utf-8")).toBe(true);
      expect(isTextContentType("image/png; charset=utf-8")).toBe(false);
    });

    it("handles content type with whitespace", () => {
      expect(isTextContentType("  text/html  ")).toBe(true);
      expect(isTextContentType("  application/json  ")).toBe(true);
    });

    it("is case insensitive", () => {
      expect(isTextContentType("Application/JSON")).toBe(true);
      expect(isTextContentType("TEXT/HTML")).toBe(true);
      expect(isTextContentType("Text/Plain")).toBe(true);
      expect(isTextContentType("IMAGE/PNG")).toBe(false);
    });

    it("returns false for whitespace-only string", () => {
      expect(isTextContentType("   ")).toBe(false);
    });
  });
});

describe("isJsonContentType", () => {
  it("detects application/json", () => {
    expect(isJsonContentType("application/json")).toBe(true);
  });

  it("detects application/json with charset parameter", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
  });

  it("detects application/ld+json", () => {
    expect(isJsonContentType("application/ld+json")).toBe(true);
  });

  it("detects application/manifest+json", () => {
    expect(isJsonContentType("application/manifest+json")).toBe(true);
  });

  it("detects application/hal+json (+json suffix)", () => {
    expect(isJsonContentType("application/hal+json")).toBe(true);
  });

  it("detects application/vnd.api+json (+json suffix)", () => {
    expect(isJsonContentType("application/vnd.api+json")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isJsonContentType("Application/JSON")).toBe(true);
    expect(isJsonContentType("APPLICATION/LD+JSON")).toBe(true);
  });

  it("rejects text/html", () => {
    expect(isJsonContentType("text/html")).toBe(false);
  });

  it("rejects application/xml", () => {
    expect(isJsonContentType("application/xml")).toBe(false);
  });

  it("rejects image/png", () => {
    expect(isJsonContentType("image/png")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isJsonContentType(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isJsonContentType("")).toBe(false);
  });
});

describe("buildTextContentTypeSqlCondition", () => {
  it("returns object with clause and params", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    expect(result).toHaveProperty("clause");
    expect(result).toHaveProperty("params");
    expect(typeof result.clause).toBe("string");
    expect(Array.isArray(result.params)).toBe(true);
  });

  it("includes IS NULL check for unknown content types", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    expect(result.clause).toContain("content_type IS NULL");
  });

  it("uses the provided column name", () => {
    const result1 = buildTextContentTypeSqlCondition("req_ct");
    expect(result1.clause).toContain("req_ct");
    expect(result1.clause).not.toContain("content_type");

    const result2 = buildTextContentTypeSqlCondition("resp_ct");
    expect(result2.clause).toContain("resp_ct");
    expect(result2.clause).not.toContain("content_type");
  });

  it("wraps all conditions in parentheses", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    expect(result.clause.startsWith("(")).toBe(true);
    expect(result.clause.endsWith(")")).toBe(true);
  });

  it("includes LIKE patterns for prefix matches", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    // text/ should be a LIKE pattern
    expect(result.clause).toContain("content_type LIKE ?");
    expect(result.params).toContain("text/%");
  });

  it("includes exact matches for specific types", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    // application/json should be an exact match
    expect(result.clause).toContain("content_type = ?");
    expect(result.params).toContain("application/json");
    expect(result.params).toContain("application/xml");
    expect(result.params).toContain("application/javascript");
  });

  it("includes suffix patterns", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    // +json, +xml, +html, +text should be LIKE patterns
    expect(result.params).toContain("%+json");
    expect(result.params).toContain("%+xml");
    expect(result.params).toContain("%+html");
    expect(result.params).toContain("%+text");
  });

  it("generates correct number of parameters", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    // Count expected params:
    // - 1 prefix match (text/)
    // - 8 exact matches (all non-slash-ending entries in TEXT_CONTENT_TYPES)
    // - 4 suffix matches (TEXT_SUFFIXES)
    // Note: IS NULL has no parameter
    const expectedParamCount =
      TEXT_CONTENT_TYPES.filter((t) => t.endsWith("/")).length + // prefix matches
      TEXT_CONTENT_TYPES.filter((t) => !t.endsWith("/")).length + // exact matches
      TEXT_SUFFIXES.length; // suffix matches

    expect(result.params).toHaveLength(expectedParamCount);
  });

  it("joins conditions with OR", () => {
    const result = buildTextContentTypeSqlCondition("content_type");
    expect(result.clause).toContain(" OR ");
    // Should have multiple OR clauses
    const orCount = (result.clause.match(/ OR /g) || []).length;
    expect(orCount).toBeGreaterThan(5);
  });

  it("maintains consistency with TEXT_CONTENT_TYPES and TEXT_SUFFIXES", () => {
    const result = buildTextContentTypeSqlCondition("content_type");

    // Verify all TEXT_CONTENT_TYPES entries are represented
    for (const entry of TEXT_CONTENT_TYPES) {
      if (entry.endsWith("/")) {
        expect(result.params).toContain(`${entry}%`);
      } else {
        expect(result.params).toContain(entry);
      }
    }

    // Verify all TEXT_SUFFIXES entries are represented
    for (const suffix of TEXT_SUFFIXES) {
      expect(result.params).toContain(`%${suffix}`);
    }
  });

  it("generates valid SQL-like structure", () => {
    const result = buildTextContentTypeSqlCondition("my_column");
    // Should look like: (my_column IS NULL OR my_column LIKE ? OR my_column = ? OR ...)
    expect(result.clause).toMatch(/^\(my_column IS NULL( OR my_column (?:LIKE|=) \?)+\)$/);
  });
});

describe("buildJsonContentTypeSqlCondition", () => {
  it("returns object with clause and params", () => {
    const result = buildJsonContentTypeSqlCondition("content_type");
    expect(result).toHaveProperty("clause");
    expect(result).toHaveProperty("params");
    expect(typeof result.clause).toBe("string");
    expect(Array.isArray(result.params)).toBe(true);
  });

  it("includes application/json as exact match", () => {
    const result = buildJsonContentTypeSqlCondition("content_type");
    expect(result.params).toContain("application/json");
  });

  it("includes +json suffix pattern", () => {
    const result = buildJsonContentTypeSqlCondition("content_type");
    expect(result.params).toContain(`%${JSON_SUFFIX}`);
  });

  it("uses the provided column name", () => {
    const result = buildJsonContentTypeSqlCondition("req_ct");
    expect(result.clause).toContain("req_ct");
    expect(result.clause).not.toContain("content_type");
  });

  it("generates correct number of parameters", () => {
    const result = buildJsonContentTypeSqlCondition("content_type");
    // One exact match per JSON_CONTENT_TYPES entry + 1 LIKE for the +json suffix
    const expectedParamCount = JSON_CONTENT_TYPES.length + 1;
    expect(result.params).toHaveLength(expectedParamCount);
  });

  it("generates valid SQL structure", () => {
    const result = buildJsonContentTypeSqlCondition("my_col");
    // Should look like: (my_col = ? OR my_col = ? OR ... OR my_col LIKE ?)
    expect(result.clause).toMatch(/^\(my_col (?:=|LIKE) \?( OR my_col (?:=|LIKE) \?)*\)$/);
  });

  it("wraps all conditions in parentheses", () => {
    const result = buildJsonContentTypeSqlCondition("content_type");
    expect(result.clause.startsWith("(")).toBe(true);
    expect(result.clause.endsWith(")")).toBe(true);
  });
});
