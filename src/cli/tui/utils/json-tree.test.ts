/**
 * Tests for JSON tree utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  buildVisibleNodes,
  toggleNode,
  defaultExpansion,
  expandAll,
  collapseAll,
  filterByPath,
  getValueAtPath,
  parentPath,
  buildBreadcrumb,
} from "./json-tree.js";

describe("buildVisibleNodes", () => {
  it("handles an empty object", () => {
    const nodes = buildVisibleNodes({}, new Set(["root"]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.key).toBe("(root)");
    expect(nodes[0]?.type).toBe("object");
    expect(nodes[0]?.value).toBe("{0 keys}");
  });

  it("handles an empty array", () => {
    const nodes = buildVisibleNodes([], new Set(["root"]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.key).toBe("(root)");
    expect(nodes[0]?.type).toBe("array");
    expect(nodes[0]?.value).toBe("[0 items]");
  });

  it("handles a primitive at root level", () => {
    const nodes = buildVisibleNodes(42, new Set());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("primitive");
    expect(nodes[0]?.value).toBe("42");
    expect(nodes[0]?.expandable).toBe(false);
  });

  it("handles a string at root level", () => {
    const nodes = buildVisibleNodes("hello", new Set());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.value).toBe('"hello"');
  });

  it("handles null at root level", () => {
    const nodes = buildVisibleNodes(null, new Set());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.value).toBe("null");
  });

  it("handles boolean at root level", () => {
    const nodes = buildVisibleNodes(true, new Set());
    expect(nodes[0]?.value).toBe("true");
  });

  it("shows children of expanded object", () => {
    const data = { name: "Alice", age: 30 };
    const nodes = buildVisibleNodes(data, new Set(["root"]));

    expect(nodes).toHaveLength(3);
    expect(nodes[0]?.key).toBe("(root)");
    expect(nodes[0]?.value).toBe("{2 keys}");
    expect(nodes[1]?.key).toBe("name");
    expect(nodes[1]?.value).toBe('"Alice"');
    expect(nodes[1]?.depth).toBe(1);
    expect(nodes[2]?.key).toBe("age");
    expect(nodes[2]?.value).toBe("30");
  });

  it("hides children of collapsed object", () => {
    const data = { name: "Alice", age: 30 };
    const nodes = buildVisibleNodes(data, new Set());

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.key).toBe("(root)");
    expect(nodes[0]?.expandable).toBe(true);
  });

  it("shows array items with bracket indices", () => {
    const data = ["a", "b", "c"];
    const nodes = buildVisibleNodes(data, new Set(["root"]));

    expect(nodes).toHaveLength(4);
    expect(nodes[1]?.key).toBe("[0]");
    expect(nodes[1]?.value).toBe('"a"');
    expect(nodes[2]?.key).toBe("[1]");
    expect(nodes[3]?.key).toBe("[2]");
  });

  it("handles nested structures", () => {
    const data = { data: { users: [{ name: "Alice" }] } };
    const expanded = new Set(["root", "root.data", "root.data.users", "root.data.users[0]"]);
    const nodes = buildVisibleNodes(data, expanded);

    expect(nodes).toHaveLength(5);
    expect(nodes[0]?.path).toBe("root");
    expect(nodes[1]?.path).toBe("root.data");
    expect(nodes[2]?.path).toBe("root.data.users");
    expect(nodes[3]?.path).toBe("root.data.users[0]");
    expect(nodes[4]?.path).toBe("root.data.users[0].name");
    expect(nodes[4]?.value).toBe('"Alice"');
  });

  it("respects collapsed parents — skips deeply nested children", () => {
    const data = { data: { users: [{ name: "Alice" }] } };
    // root expanded, but data collapsed
    const nodes = buildVisibleNodes(data, new Set(["root"]));

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.path).toBe("root");
    expect(nodes[1]?.path).toBe("root.data");
    expect(nodes[1]?.expandable).toBe(true);
  });

  it("handles empty string values", () => {
    const data = { empty: "" };
    const nodes = buildVisibleNodes(data, new Set(["root"]));
    expect(nodes[1]?.value).toBe('""');
  });

  it("handles null values inside objects", () => {
    const data = { val: null };
    const nodes = buildVisibleNodes(data, new Set(["root"]));
    expect(nodes[1]?.value).toBe("null");
  });

  it("shows singular item/key for count of 1", () => {
    const data = { a: 1 };
    const nodes = buildVisibleNodes(data, new Set());
    expect(nodes[0]?.value).toBe("{1 key}");

    const arr = [1];
    const arrNodes = buildVisibleNodes(arr, new Set());
    expect(arrNodes[0]?.value).toBe("[1 item]");
  });

  it("handles keys with special characters", () => {
    const data = { "foo.bar": 1, "a b": 2 };
    const nodes = buildVisibleNodes(data, new Set(["root"]));
    expect(nodes).toHaveLength(3);
    expect(nodes[1]?.key).toBe("foo.bar");
    expect(nodes[2]?.key).toBe("a b");
  });

  it("handles numeric keys in objects", () => {
    const data = { "0": "zero", "1": "one" };
    const nodes = buildVisibleNodes(data, new Set(["root"]));
    expect(nodes[1]?.key).toBe("0");
    expect(nodes[2]?.key).toBe("1");
  });

  it("handles a moderately large structure", () => {
    // Build a structure with ~200 leaf nodes
    const data: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 20; i++) {
      const inner: Record<string, number> = {};
      for (let j = 0; j < 10; j++) {
        inner[`field${j}`] = j;
      }
      data[`group${i}`] = inner;
    }

    const expanded = expandAll(data);
    const nodes = buildVisibleNodes(data, expanded);
    // 1 root + 20 groups + 200 fields = 221
    expect(nodes).toHaveLength(221);
  });
});

describe("toggleNode", () => {
  it("adds a path when not present", () => {
    const result = toggleNode(new Set(), "root.data");
    expect(result.has("root.data")).toBe(true);
  });

  it("removes a path when present", () => {
    const result = toggleNode(new Set(["root.data"]), "root.data");
    expect(result.has("root.data")).toBe(false);
  });

  it("returns a new Set instance", () => {
    const original = new Set(["root"]);
    const result = toggleNode(original, "root.data");
    expect(result).not.toBe(original);
  });

  it("is idempotent when toggled twice", () => {
    const original = new Set(["root"]);
    const first = toggleNode(original, "root.data");
    const second = toggleNode(first, "root.data");
    expect([...second].sort()).toEqual([...original].sort());
  });
});

describe("defaultExpansion", () => {
  it("returns empty set for primitives", () => {
    expect(defaultExpansion(42).size).toBe(0);
    expect(defaultExpansion("hello").size).toBe(0);
    expect(defaultExpansion(null).size).toBe(0);
  });

  it("expands root and depth-1 containers for object", () => {
    const data = { users: [1, 2], config: { debug: true }, name: "test" };
    const expanded = defaultExpansion(data);

    expect(expanded.has("root")).toBe(true);
    expect(expanded.has("root.users")).toBe(true);
    expect(expanded.has("root.config")).toBe(true);
    // "name" is a primitive, should not be expanded
    expect(expanded.has("root.name")).toBe(false);
    expect(expanded.size).toBe(3);
  });

  it("expands root and depth-1 containers for array", () => {
    const data = [{ a: 1 }, { b: 2 }];
    const expanded = defaultExpansion(data);

    expect(expanded.has("root")).toBe(true);
    expect(expanded.has("root[0]")).toBe(true);
    expect(expanded.has("root[1]")).toBe(true);
    expect(expanded.size).toBe(3);
  });

  it("does not expand deeper containers", () => {
    const data = { level1: { level2: { level3: true } } };
    const expanded = defaultExpansion(data);

    expect(expanded.has("root")).toBe(true);
    expect(expanded.has("root.level1")).toBe(true);
    expect(expanded.has("root.level1.level2")).toBe(false);
  });
});

describe("expandAll", () => {
  it("expands all container nodes", () => {
    const data = { a: { b: { c: 1 } }, d: [1, 2] };
    const expanded = expandAll(data);

    expect(expanded.has("root")).toBe(true);
    expect(expanded.has("root.a")).toBe(true);
    expect(expanded.has("root.a.b")).toBe(true);
    expect(expanded.has("root.d")).toBe(true);
    expect(expanded.size).toBe(4);
  });

  it("returns empty set for primitive data", () => {
    expect(expandAll(42).size).toBe(0);
  });
});

describe("collapseAll", () => {
  it("returns an empty set", () => {
    const result = collapseAll();
    expect(result.size).toBe(0);
  });
});

describe("parentPath", () => {
  it("returns null for root", () => {
    expect(parentPath("root")).toBeNull();
  });

  it("returns root for a top-level key", () => {
    expect(parentPath("root.data")).toBe("root");
  });

  it("handles nested dot paths", () => {
    expect(parentPath("root.data.users")).toBe("root.data");
  });

  it("handles array index paths", () => {
    expect(parentPath("root.data.users[0]")).toBe("root.data.users");
  });

  it("handles nested array access", () => {
    expect(parentPath("root.data[0].name")).toBe("root.data[0]");
  });

  it("handles quoted bracket notation for keys with dots", () => {
    expect(parentPath('root.foo["bar.baz"]')).toBe("root.foo");
  });
});

describe("filterByPath", () => {
  const data = {
    data: {
      users: [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
    },
    status: "ok",
    count: 2,
  };

  it("returns null for empty filter", () => {
    expect(filterByPath(data, "")).toBeNull();
    expect(filterByPath(data, "   ")).toBeNull();
  });

  it("finds exact path match", () => {
    const result = filterByPath(data, "status");
    expect(result).not.toBeNull();
    expect(result?.matchingPaths.has("root.status")).toBe(true);
  });

  it("finds nested path match", () => {
    const result = filterByPath(data, "data.users");
    expect(result).not.toBeNull();
    expect(result?.matchingPaths.has("root.data.users")).toBe(true);
  });

  it("auto-expands ancestors for matched paths", () => {
    const result = filterByPath(data, "data.users[0].name");
    expect(result).not.toBeNull();
    expect(result?.expandedPaths.has("root")).toBe(true);
    expect(result?.expandedPaths.has("root.data")).toBe(true);
    expect(result?.expandedPaths.has("root.data.users")).toBe(true);
    expect(result?.expandedPaths.has("root.data.users[0]")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const result = filterByPath(data, "DATA.USERS");
    expect(result).not.toBeNull();
    expect(result?.matchingPaths.has("root.data.users")).toBe(true);
  });

  it("matches prefix — expands matching containers", () => {
    const result = filterByPath(data, "data");
    expect(result).not.toBeNull();
    expect(result?.matchingPaths.has("root.data")).toBe(true);
    // "data" is a prefix of "data.users", etc. so those should match too
    expect(result?.matchingPaths.has("root.data.users")).toBe(true);
  });

  it("matches array index notation", () => {
    const result = filterByPath(data, "data.users[0]");
    expect(result).not.toBeNull();
    expect(result?.matchingPaths.has("root.data.users[0]")).toBe(true);
  });

  it("handles no matches gracefully", () => {
    const result = filterByPath(data, "nonexistent.path");
    expect(result).not.toBeNull();
    expect(result?.matchingPaths.size).toBe(0);
  });
});

describe("getValueAtPath", () => {
  const data = {
    data: {
      users: [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
    },
    status: "ok",
    count: 2,
    empty: "",
    nil: null,
  };

  it("returns the root data for root path", () => {
    expect(getValueAtPath(data, "root")).toBe(data);
  });

  it("resolves a simple key", () => {
    expect(getValueAtPath(data, "root.status")).toBe("ok");
  });

  it("resolves a nested key", () => {
    expect(getValueAtPath(data, "root.data.users")).toBe(data.data.users);
  });

  it("resolves array indices", () => {
    expect(getValueAtPath(data, "root.data.users[0]")).toBe(data.data.users[0]);
    expect(getValueAtPath(data, "root.data.users[0].name")).toBe("Alice");
    expect(getValueAtPath(data, "root.data.users[1].age")).toBe(25);
  });

  it("returns undefined for nonexistent path", () => {
    expect(getValueAtPath(data, "root.nonexistent")).toBeUndefined();
  });

  it("returns null values correctly", () => {
    expect(getValueAtPath(data, "root.nil")).toBeNull();
  });

  it("returns empty string values correctly", () => {
    expect(getValueAtPath(data, "root.empty")).toBe("");
  });

  it("returns numeric values correctly", () => {
    expect(getValueAtPath(data, "root.count")).toBe(2);
  });

  it("handles path traversal through null", () => {
    expect(getValueAtPath(data, "root.nil.foo")).toBeUndefined();
  });
});

describe("buildBreadcrumb", () => {
  it("returns [(root)] for root path", () => {
    expect(buildBreadcrumb("root")).toEqual(["(root)"]);
  });

  it("builds breadcrumb for dotted path", () => {
    expect(buildBreadcrumb("root.data.users")).toEqual(["(root)", "data", "users"]);
  });

  it("builds breadcrumb with array indices", () => {
    expect(buildBreadcrumb("root.data.users[0].name")).toEqual([
      "(root)",
      "data",
      "users",
      "[0]",
      "name",
    ]);
  });

  it("handles a single key", () => {
    expect(buildBreadcrumb("root.status")).toEqual(["(root)", "status"]);
  });
});
