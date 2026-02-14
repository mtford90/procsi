/**
 * Filter bar for narrowing displayed interceptor events by search text, log level, and interceptor name.
 * Activated by '/' in the event log modal — maintains local state until Enter confirms.
 *
 * Tab/Shift+Tab cycles focus between three fields: search, level, interceptor.
 * When focused on search, all keys are text input.
 * When focused on level/interceptor, left/right arrows cycle the value.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";

const LEVEL_CYCLE = ["ALL", "ERROR", "WARN+"] as const;
const MAX_SEARCH_LENGTH = 200;
const FILTER_DEBOUNCE_MS = 150;

type FilterField = "search" | "level" | "interceptor";
const FIELD_ORDER: FilterField[] = ["search", "level", "interceptor"];

export interface EventFilter {
  level?: "error" | "warn"; // undefined = all
  interceptor?: string; // undefined = all
  search?: string;
}

export interface EventFilterBarProps {
  isActive: boolean;
  filter: EventFilter;
  onFilterChange: (filter: EventFilter) => void;
  onClose: () => void;
  /** Called on Escape — reverts filter to pre-open state */
  onCancel?: () => void;
  /** Unique interceptor names from all events (for cycling) */
  interceptorNames: string[];
  width: number;
}

export function EventFilterBar({
  isActive,
  filter,
  onFilterChange,
  onCancel,
  onClose,
  interceptorNames,
  width,
}: EventFilterBarProps): React.ReactElement {
  const [search, setSearch] = useState(filter.search ?? "");
  // Note: these initialisers only run on mount. This is safe because the parent
  // conditionally renders EventFilterBar ({showFilter && <EventFilterBar />}), so it
  // unmounts on close and remounts with fresh state on reopen.
  const [levelIndex, setLevelIndex] = useState<number>(() => {
    if (filter.level === "error") return 1;
    if (filter.level === "warn") return 2;
    return 0;
  });
  const [interceptorIndex, setInterceptorIndex] = useState<number>(() => {
    if (filter.interceptor) {
      const idx = interceptorNames.findIndex((name) => name === filter.interceptor);
      // offset by 1 because index 0 in our cycling means "all" (no filter)
      return idx >= 0 ? idx + 1 : 0;
    }
    return 0;
  });
  const [focusedField, setFocusedField] = useState<FilterField>("search");

  function buildFilter(): EventFilter {
    const result: EventFilter = {};

    if (search.trim()) {
      result.search = search.trim();
    }

    if (levelIndex === 1) {
      result.level = "error";
    } else if (levelIndex === 2) {
      result.level = "warn";
    }

    if (interceptorIndex > 0) {
      const name = interceptorNames[interceptorIndex - 1];
      if (name) {
        result.interceptor = name;
      }
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
  }, [search, levelIndex, interceptorIndex, onFilterChange]);

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

      if (focusedField === "level") {
        if (key.rightArrow || key.downArrow) {
          cycleField(setLevelIndex, LEVEL_CYCLE.length - 1, 1);
        } else if (key.leftArrow || key.upArrow) {
          cycleField(setLevelIndex, LEVEL_CYCLE.length - 1, -1);
        }
        return;
      }

      if (focusedField === "interceptor") {
        if (key.rightArrow || key.downArrow) {
          cycleField(setInterceptorIndex, interceptorNames.length, 1);
        } else if (key.leftArrow || key.upArrow) {
          cycleField(setInterceptorIndex, interceptorNames.length, -1);
        }
        return;
      }
    },
    { isActive },
  );

  const currentLevel = LEVEL_CYCLE[levelIndex] ?? "ALL";
  const currentInterceptor = interceptorIndex > 0 ? interceptorNames[interceptorIndex - 1] : "ALL";

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
      <Text dimColor>level:</Text>
      <Text
        color={levelIndex > 0 ? "yellow" : "white"}
        bold={focusedField === "level"}
        underline={focusedField === "level"}
      >
        {currentLevel}
      </Text>
      <Text color="gray">{"  "}</Text>
      <Text dimColor>interceptor:</Text>
      <Text
        color={interceptorIndex > 0 ? "yellow" : "white"}
        bold={focusedField === "interceptor"}
        underline={focusedField === "interceptor"}
      >
        {currentInterceptor ?? "ALL"}
      </Text>
      <Text color="gray">{"  "}</Text>
      <Text dimColor>Tab=switch Enter=close Esc=cancel</Text>
    </Box>
  );
}
