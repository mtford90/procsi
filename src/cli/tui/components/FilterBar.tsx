/**
 * Filter bar for narrowing displayed requests by search text, HTTP method, and status range.
 * Activated by '/' in the main TUI — maintains local state until Enter confirms.
 *
 * Tab/Shift+Tab cycles focus between three fields: search, method, status.
 * When focused on search, all keys are text input.
 * When focused on method/status, left/right arrows cycle the value.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { RequestFilter } from "../../../shared/types.js";
import { parseUrlSearchInput } from "../../../shared/regex-filter.js";

const METHOD_CYCLE = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const STATUS_CYCLE = ["2xx", "3xx", "4xx", "5xx"] as const;
const MAX_SEARCH_LENGTH = 200;
const FILTER_DEBOUNCE_MS = 150;

type FilterField = "search" | "method" | "status" | "saved" | "source";
const FIELD_ORDER: FilterField[] = ["search", "method", "status", "saved", "source"];

export interface FilterBarProps {
  isActive: boolean;
  filter: RequestFilter;
  onFilterChange: (filter: RequestFilter) => void;
  onClose: () => void;
  /** Called on Escape — reverts filter to pre-open state */
  onCancel?: () => void;
  width: number;
}

export function FilterBar({
  isActive,
  filter,
  onFilterChange,
  onClose,
  onCancel,
  width,
}: FilterBarProps): React.ReactElement {
  const [search, setSearch] = useState(filter.search ?? "");
  // Note: these initialisers only run on mount. This is safe because App.tsx
  // conditionally renders FilterBar ({showFilter && <FilterBar />}), so it
  // unmounts on close and remounts with fresh state on reopen.
  const [methodIndex, setMethodIndex] = useState<number>(() => {
    if (filter.methods && filter.methods.length === 1) {
      const method = filter.methods[0];
      const idx = METHOD_CYCLE.findIndex((m) => m === method);
      // offset by 1 because index 0 in our cycling means "all" (no filter)
      return idx >= 0 ? idx + 1 : 0;
    }
    return 0;
  });
  const [statusIndex, setStatusIndex] = useState<number>(() => {
    if (filter.statusRange) {
      const idx = STATUS_CYCLE.findIndex((s) => s === filter.statusRange);
      return idx >= 0 ? idx + 1 : 0;
    }
    return 0;
  });
  const [savedIndex, setSavedIndex] = useState<number>(() => {
    return filter.saved === true ? 1 : 0;
  });
  const [source, setSource] = useState(filter.source ?? "");
  const [focusedField, setFocusedField] = useState<FilterField>("search");

  function buildFilter(): RequestFilter {
    const result: RequestFilter = {};

    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      try {
        const parsed = parseUrlSearchInput(trimmedSearch);
        if (parsed.regex) {
          result.regex = parsed.regex.pattern;
          if (parsed.regex.flags) {
            result.regexFlags = parsed.regex.flags;
          }
        } else if (parsed.search) {
          result.search = parsed.search;
        }
      } catch {
        // Keep TUI resilient while typing incomplete/invalid regex literals.
        // Fallback to plain substring search instead of surfacing an error state.
        result.search = trimmedSearch;
      }
    }

    if (methodIndex > 0) {
      const method = METHOD_CYCLE[methodIndex - 1];
      if (method) {
        result.methods = [method];
      }
    }

    if (statusIndex > 0) {
      const status = STATUS_CYCLE[statusIndex - 1];
      if (status) {
        result.statusRange = status;
      }
    }

    if (savedIndex > 0) {
      result.saved = true;
    }

    if (source.trim()) {
      result.source = source.trim();
    }

    return result;
  }

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Stable reference to buildFilter for use in the debounce effect
  const buildFilterRef = useRef(buildFilter);
  buildFilterRef.current = buildFilter;

  // Live debounced filter application
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onFilterChange(buildFilterRef.current());
    }, FILTER_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search, methodIndex, statusIndex, savedIndex, source, onFilterChange]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function cycleField(setter: React.Dispatch<React.SetStateAction<number>>, length: number, direction: 1 | -1): void {
    setter((prev) => {
      const total = length + 1; // +1 for the "ALL" option at index 0
      return (prev + direction + total) % total;
    });
  }

  useInput(
    (input, key) => {
      if (key.escape) {
        if (onCancel) {
          onCancel();
        } else {
          onClose();
        }
        return;
      }

      if (key.return) {
        // Filter already applied live — just close the bar
        onClose();
        return;
      }

      // Tab/Shift+Tab cycles focus between fields
      if (key.tab) {
        setFocusedField((prev) => {
          const currentIdx = FIELD_ORDER.indexOf(prev);
          const direction = key.shift ? -1 : 1;
          const nextIdx = (currentIdx + direction + FIELD_ORDER.length) % FIELD_ORDER.length;
          return FIELD_ORDER[nextIdx] ?? "search";
        });
        return;
      }

      // Field-specific input handling
      if (focusedField === "search") {
        if (key.backspace || key.delete) {
          setSearch((prev) => prev.slice(0, -1));
          return;
        }

        // Only accept single characters to filter out mouse escape sequences
        // which arrive as multi-character strings from ink-mouse.
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setSearch((prev) => {
            if (prev.length >= MAX_SEARCH_LENGTH) return prev;
            return prev + input;
          });
        }
        return;
      }

      if (focusedField === "method") {
        if (key.rightArrow || key.downArrow) {
          cycleField(setMethodIndex, METHOD_CYCLE.length, 1);
        } else if (key.leftArrow || key.upArrow) {
          cycleField(setMethodIndex, METHOD_CYCLE.length, -1);
        }
        return;
      }

      if (focusedField === "status") {
        if (key.rightArrow || key.downArrow) {
          cycleField(setStatusIndex, STATUS_CYCLE.length, 1);
        } else if (key.leftArrow || key.upArrow) {
          cycleField(setStatusIndex, STATUS_CYCLE.length, -1);
        }
        return;
      }

      if (focusedField === "saved") {
        if (key.rightArrow || key.downArrow || key.leftArrow || key.upArrow) {
          setSavedIndex((prev) => (prev === 0 ? 1 : 0));
        }
        return;
      }

      if (focusedField === "source") {
        if (key.backspace || key.delete) {
          setSource((prev) => prev.slice(0, -1));
          return;
        }

        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setSource((prev) => {
            if (prev.length >= MAX_SEARCH_LENGTH) return prev;
            return prev + input;
          });
        }
        return;
      }
    },
    { isActive },
  );

  const currentMethod = methodIndex > 0 ? METHOD_CYCLE[methodIndex - 1] : "ALL";
  const currentStatus = statusIndex > 0 ? STATUS_CYCLE[statusIndex - 1] : "ALL";
  const currentSaved = savedIndex > 0 ? "YES" : "ALL";

  return (
    <Box
      borderStyle="single"
      borderBottom
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      width={width}
      height={2}
    >
      <Text color="cyan" bold>
        /
      </Text>
      <Text> {search}</Text>
      {isActive && focusedField === "search" && <Text color="cyan">█</Text>}
      <Text color="gray">{"  "}</Text>
      <Text dimColor>method:</Text>
      <Text
        color={methodIndex > 0 ? "yellow" : "white"}
        bold={focusedField === "method"}
        underline={focusedField === "method"}
      >
        {currentMethod}
      </Text>
      <Text color="gray">{"  "}</Text>
      <Text dimColor>status:</Text>
      <Text
        color={statusIndex > 0 ? "yellow" : "white"}
        bold={focusedField === "status"}
        underline={focusedField === "status"}
      >
        {currentStatus}
      </Text>
      <Text color="gray">{"  "}</Text>
      <Text dimColor>saved:</Text>
      <Text
        color={savedIndex > 0 ? "yellow" : "white"}
        bold={focusedField === "saved"}
        underline={focusedField === "saved"}
      >
        {currentSaved}
      </Text>
      <Text color="gray">{"  "}</Text>
      <Text dimColor>source:</Text>
      <Text color={source ? "yellow" : "white"} bold={focusedField === "source"} underline={focusedField === "source"}>
        {source || "ALL"}
      </Text>
      {isActive && focusedField === "source" && <Text color="cyan">█</Text>}
      <Text color="gray">{"  "}</Text>
      <Text dimColor>Tab=switch Enter=close Esc=cancel space=AND /re/</Text>
    </Box>
  );
}
