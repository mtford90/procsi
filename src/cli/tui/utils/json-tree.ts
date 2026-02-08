/**
 * Pure functions for building and navigating a collapsible JSON tree.
 * Used by JsonExplorerModal to render an interactive tree view.
 */

export interface JsonTreeNode {
  /** Unique key path, e.g. "root.data.users[0].name" */
  path: string;
  /** Display label, e.g. "name", "[0]", "(root)" */
  key: string;
  /** Indentation level (0 = root) */
  depth: number;
  /** Node type */
  type: "object" | "array" | "primitive";
  /** Display value — primitives: formatted value, containers: "{3 keys}" / "[5 items]" */
  value: string;
  /** Whether the node has children that can be expanded */
  expandable: boolean;
}

const ROOT_PATH = "root";

/**
 * Format a primitive value for display.
 */
function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  return String(value);
}

/**
 * Determine the type classification of a value.
 */
function classifyValue(value: unknown): "object" | "array" | "primitive" {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "primitive";
}

/**
 * Build a container summary string, e.g. "{3 keys}" or "[5 items]".
 */
function containerSummary(value: unknown): string {
  if (Array.isArray(value)) {
    const len = value.length;
    return `[${len} ${len === 1 ? "item" : "items"}]`;
  }
  if (value !== null && typeof value === "object") {
    const len = Object.keys(value as Record<string, unknown>).length;
    return `{${len} ${len === 1 ? "key" : "keys"}}`;
  }
  return "";
}

/**
 * Build a child path from a parent path and a key.
 */
function childPath(parentPath: string, key: string, isArrayIndex: boolean): string {
  if (isArrayIndex) return `${parentPath}[${key}]`;
  // Dotted keys or keys with special chars get bracket notation
  if (/[.[\]\s]/.test(key) || key === "") {
    return `${parentPath}["${key}"]`;
  }
  return `${parentPath}.${key}`;
}

/**
 * Build a flat array of visible tree nodes by recursively walking the JSON data.
 * Children of collapsed nodes are skipped.
 */
export function buildVisibleNodes(data: unknown, expandedPaths: Set<string>): JsonTreeNode[] {
  const nodes: JsonTreeNode[] = [];

  function walk(value: unknown, path: string, key: string, depth: number): void {
    const type = classifyValue(value);
    const expandable = type !== "primitive";
    const displayValue = expandable ? containerSummary(value) : formatPrimitive(value);

    nodes.push({ path, key, depth, type, value: displayValue, expandable });

    if (!expandable || !expandedPaths.has(path)) return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const cp = childPath(path, String(i), true);
        walk(value[i], cp, `[${i}]`, depth + 1);
      }
    } else if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [k, v] of entries) {
        const cp = childPath(path, k, false);
        walk(v, cp, k, depth + 1);
      }
    }
  }

  walk(data, ROOT_PATH, "(root)", 0);
  return nodes;
}

/**
 * Toggle a node's expansion state. Returns a new Set.
 */
export function toggleNode(expandedPaths: Set<string>, path: string): Set<string> {
  const next = new Set(expandedPaths);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

/**
 * Compute default expansion: root + all depth-1 nodes.
 */
export function defaultExpansion(data: unknown): Set<string> {
  const paths = new Set<string>();
  const type = classifyValue(data);
  if (type === "primitive") return paths;

  paths.add(ROOT_PATH);

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const cp = childPath(ROOT_PATH, String(i), true);
      if (classifyValue(data[i]) !== "primitive") {
        paths.add(cp);
      }
    }
  } else if (data !== null && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const cp = childPath(ROOT_PATH, k, false);
      if (classifyValue(v) !== "primitive") {
        paths.add(cp);
      }
    }
  }

  return paths;
}

/**
 * Expand all container nodes in the data.
 */
export function expandAll(data: unknown): Set<string> {
  const paths = new Set<string>();

  function walk(value: unknown, path: string): void {
    const type = classifyValue(value);
    if (type === "primitive") return;

    paths.add(path);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], childPath(path, String(i), true));
      }
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, childPath(path, k, false));
      }
    }
  }

  walk(data, ROOT_PATH);
  return paths;
}

/**
 * Collapse everything.
 */
export function collapseAll(): Set<string> {
  return new Set<string>();
}

/**
 * Find the parent path of a given path.
 * Returns null for the root path.
 */
export function parentPath(path: string): string | null {
  if (path === ROOT_PATH) return null;

  // Handle bracket notation: root.foo[0] → root.foo
  // Handle dot notation: root.foo.bar → root.foo
  const bracketMatch = path.match(/^(.+)\[\d+\]$/);
  if (bracketMatch?.[1]) return bracketMatch[1];

  const quotedBracketMatch = path.match(/^(.+)\["[^"]*"\]$/);
  if (quotedBracketMatch?.[1]) return quotedBracketMatch[1];

  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return null;

  return path.substring(0, lastDot);
}

export interface FilterResult {
  matchingPaths: Set<string>;
  expandedPaths: Set<string>;
}

/**
 * Filter nodes by dotted path prefix.
 * Returns matching paths and the set of paths that should be expanded to reveal them.
 * Returns null if filter text is empty.
 *
 * Supports:
 * - Dotted paths: "data.users"
 * - Array indices: "data.users[0]"
 * - Case-insensitive matching
 */
export function filterByPath(data: unknown, filterText: string): FilterResult | null {
  const trimmed = filterText.trim();
  if (trimmed === "") return null;

  const matchingPaths = new Set<string>();
  const expandedPaths = new Set<string>();

  // Normalise the filter to match against path segments
  const filterLower = trimmed.toLowerCase();

  function walk(value: unknown, path: string): void {
    // Build a "display path" without the root prefix for user-facing matching
    const displayPath = path === ROOT_PATH ? "" : path.replace(/^root\.?/, "");
    const displayPathLower = displayPath.toLowerCase();

    // Match if the display path starts with the filter, or the filter starts with the display path
    // (the latter allows partial input to highlight ancestors)
    const isMatch =
      displayPathLower.startsWith(filterLower) || filterLower.startsWith(displayPathLower);

    if (isMatch && displayPath !== "") {
      matchingPaths.add(path);

      // Auto-expand all ancestors to reveal the match
      let ancestor = parentPath(path);
      while (ancestor !== null) {
        expandedPaths.add(ancestor);
        ancestor = parentPath(ancestor);
      }

      // If the filter is an exact prefix of this path, expand this node too
      if (filterLower.startsWith(displayPathLower)) {
        expandedPaths.add(path);
      }
    }

    // Continue walking children
    const type = classifyValue(value);
    if (type === "primitive") return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], childPath(path, String(i), true));
      }
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, childPath(path, k, false));
      }
    }
  }

  walk(data, ROOT_PATH);
  return { matchingPaths, expandedPaths };
}

/**
 * Resolve a tree node path to the actual value in the data.
 */
export function getValueAtPath(data: unknown, path: string): unknown {
  if (path === ROOT_PATH) return data;

  // Parse the path segments after "root."
  const withoutRoot = path.replace(/^root\.?/, "");
  if (withoutRoot === "") return data;

  // Tokenise: handles both dot notation and bracket notation
  const segments: string[] = [];
  let i = 0;
  while (i < withoutRoot.length) {
    if (withoutRoot[i] === "[") {
      // Bracket notation
      const closeIdx = withoutRoot.indexOf("]", i);
      if (closeIdx === -1) break;
      let segment = withoutRoot.substring(i + 1, closeIdx);
      // Remove quotes from ["key"] notation
      if (segment.startsWith('"') && segment.endsWith('"')) {
        segment = segment.substring(1, segment.length - 1);
      }
      segments.push(segment);
      i = closeIdx + 1;
      // Skip trailing dot
      if (i < withoutRoot.length && withoutRoot[i] === ".") i++;
    } else {
      // Dot notation
      let dotIdx = withoutRoot.indexOf(".", i);
      const bracketIdx = withoutRoot.indexOf("[", i);
      if (dotIdx === -1) dotIdx = withoutRoot.length;
      if (bracketIdx !== -1 && bracketIdx < dotIdx) {
        segments.push(withoutRoot.substring(i, bracketIdx));
        i = bracketIdx;
      } else {
        segments.push(withoutRoot.substring(i, dotIdx));
        i = dotIdx + 1;
      }
    }
  }

  let current: unknown = data;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const idx = parseInt(segment, 10);
      if (isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Build a breadcrumb trail from a node path.
 * e.g. "root.data.users[0].name" → ["(root)", "data", "users", "[0]", "name"]
 */
export function buildBreadcrumb(path: string): string[] {
  if (path === ROOT_PATH) return ["(root)"];

  const parts: string[] = ["(root)"];
  const withoutRoot = path.replace(/^root\.?/, "");
  if (withoutRoot === "") return parts;

  let i = 0;
  while (i < withoutRoot.length) {
    if (withoutRoot[i] === "[") {
      const closeIdx = withoutRoot.indexOf("]", i);
      if (closeIdx === -1) break;
      const segment = withoutRoot.substring(i, closeIdx + 1);
      parts.push(segment);
      i = closeIdx + 1;
      if (i < withoutRoot.length && withoutRoot[i] === ".") i++;
    } else {
      let dotIdx = withoutRoot.indexOf(".", i);
      const bracketIdx = withoutRoot.indexOf("[", i);
      if (dotIdx === -1) dotIdx = withoutRoot.length;
      if (bracketIdx !== -1 && bracketIdx < dotIdx) {
        parts.push(withoutRoot.substring(i, bracketIdx));
        i = bracketIdx;
      } else {
        parts.push(withoutRoot.substring(i, dotIdx));
        i = dotIdx + 1;
      }
    }
  }

  return parts;
}
