/**
 * Root TUI component for browsing captured HTTP traffic.
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput, useApp, useStdin } from "ink";
import { MouseProvider, useOnClick, useOnWheel, useOnMouseEnter, useOnMouseLeave } from "@ink-tools/ink-mouse";
import { useStdoutDimensions } from "./hooks/useStdoutDimensions.js";
import { useRequests } from "./hooks/useRequests.js";
import { useExport } from "./hooks/useExport.js";
import { useSpinner } from "./hooks/useSpinner.js";
import { useBodyExport, generateFilename } from "./hooks/useBodyExport.js";
import { formatSize } from "./utils/formatters.js";
import { copyToClipboard } from "./utils/clipboard.js";
import { isBinaryContent } from "./utils/binary.js";
import { openInExternalApp } from "./utils/open-external.js";
import { RequestList } from "./components/RequestList.js";
import {
  AccordionPanel,
  SECTION_REQUEST,
  SECTION_REQUEST_BODY,
  SECTION_RESPONSE,
  SECTION_RESPONSE_BODY,
  hasExportableBody,
} from "./components/AccordionPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { FilterBar } from "./components/FilterBar.js";
import { ExportModal, type ExportAction } from "./components/ExportModal.js";
import { HelpModal } from "./components/HelpModal.js";
import { InfoModal } from "./components/InfoModal.js";
import { isFilterActive } from "./utils/filters.js";
import { findProjectRoot, getHtpxPaths, readProxyPort } from "../../shared/project.js";
import type { CapturedRequest, RequestFilter } from "../../shared/types.js";

interface AppProps {
  /** Enable keyboard input in tests (bypasses TTY check) */
  __testEnableInput?: boolean;
  /** Override project root directory (from --dir flag) */
  projectRoot?: string;
}

type Panel = "list" | "accordion";

export const MIN_TERMINAL_COLUMNS = 60;
export const MIN_TERMINAL_ROWS = 10;

function AppContent({ __testEnableInput, projectRoot }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [columns, rows] = useStdoutDimensions();

  // Filter state
  const [filter, setFilter] = useState<RequestFilter>({});
  const [showFilter, setShowFilter] = useState(false);

  const { requests, isLoading, error, refresh, getFullRequest, getAllFullRequests } = useRequests({ filter, projectRoot });
  const { exportCurl, exportHar } = useExport();
  const { saveBody } = useBodyExport();
  const spinnerFrame = useSpinner(isLoading && requests.length === 0);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activePanel, setActivePanel] = useState<Panel>("list");
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [showFullUrl, setShowFullUrl] = useState(false);
  const [hoveredPanel, setHoveredPanel] = useState<Panel | null>(null);
  const [listScrollOffset, setListScrollOffset] = useState(0);

  // Accordion state
  const [focusedSection, setFocusedSection] = useState(SECTION_REQUEST);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    () => new Set([SECTION_REQUEST, SECTION_RESPONSE_BODY]),
  );

  // Help modal state
  const [showHelp, setShowHelp] = useState(false);

  // Info modal state
  const [showInfo, setShowInfo] = useState(false);

  // Proxy details for info modal (one-time sync read)
  const proxyPort = useMemo(() => {
    const root = projectRoot ?? findProjectRoot();
    return root ? readProxyPort(root) : undefined;
  }, [projectRoot]);

  const caCertPath = useMemo(() => {
    const root = projectRoot ?? findProjectRoot();
    return root ? getHtpxPaths(root).caCertFile : "";
  }, [projectRoot]);

  // Save modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savingBodyType, setSavingBodyType] = useState<"request" | "response" | null>(null);

  // Full request data for the selected item (fetched on demand)
  const [selectedFullRequest, setSelectedFullRequest] = useState<CapturedRequest | null>(null);

  // Refs for mouse interaction
  const listPanelRef = useRef(null);
  const accordionPanelRef = useRef(null);

  // Ref for status message timeout cleanup
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Refs for wheel handler to avoid stale closures
  // (useOnWheel may not update its stored callback on every render)
  const contentHeightRef = useRef(rows - 2);
  contentHeightRef.current = rows - 2;
  const requestsLengthRef = useRef(requests.length);
  requestsLengthRef.current = requests.length;

  // Get the summary for the currently selected request
  const selectedSummary = requests[selectedIndex];

  // Handle filter change from the filter bar
  const handleFilterChange = useCallback((newFilter: RequestFilter) => {
    setFilter(newFilter);
    setSelectedIndex(0);
  }, []);

  // Handle item click from the request list
  const handleItemClick = useCallback((index: number) => {
    setSelectedIndex(index);
    setActivePanel("list");
  }, []);

  // Fetch full request data when selection changes
  useEffect(() => {
    if (selectedSummary) {
      void getFullRequest(selectedSummary.id).then(setSelectedFullRequest);
    } else {
      setSelectedFullRequest(null);
    }
  }, [selectedSummary?.id, getFullRequest]);

  // Toggle a section's expanded state
  const handleSectionToggle = useCallback((index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Handle scroll wheel on list panel - scrolls the view, not the selection
  useOnWheel(listPanelRef, (event) => {
    // Use refs to avoid stale closures if useOnWheel caches the callback
    const visibleHeight = Math.max(1, contentHeightRef.current - 2);
    const maxOffset = Math.max(0, requestsLengthRef.current - visibleHeight);
    if (event.button === "wheel-up") {
      setListScrollOffset((prev) => Math.max(prev - 1, 0));
    } else if (event.button === "wheel-down") {
      setListScrollOffset((prev) => Math.min(prev + 1, maxOffset));
    }
  });

  // Handle scroll wheel on accordion panel for navigating sections
  useOnWheel(accordionPanelRef, (event) => {
    if (event.button === "wheel-up") {
      setFocusedSection((prev) => Math.max(prev - 1, 0));
    } else if (event.button === "wheel-down") {
      setFocusedSection((prev) => Math.min(prev + 1, 3));
    }
  });

  // Handle click on panels to activate them
  useOnClick(listPanelRef, () => setActivePanel("list"));
  useOnClick(accordionPanelRef, () => setActivePanel("accordion"));

  // Handle hover on panels
  useOnMouseEnter(listPanelRef, () => setHoveredPanel("list"));
  useOnMouseLeave(listPanelRef, () => setHoveredPanel((prev) => (prev === "list" ? null : prev)));
  useOnMouseEnter(accordionPanelRef, () => setHoveredPanel("accordion"));
  useOnMouseLeave(accordionPanelRef, () => setHoveredPanel((prev) => (prev === "accordion" ? null : prev)));

  // Clear status message after a delay
  const showStatus = useCallback((message: string) => {
    // Clear any existing timeout to prevent race conditions
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(undefined), 3000);
  }, []);

  // Cleanup status timeout on unmount
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  // Determine if the currently focused body section has exportable content
  const currentBodyIsExportable = useMemo(() => {
    if (!selectedFullRequest || activePanel !== "accordion") return false;

    if (focusedSection === SECTION_REQUEST_BODY) {
      return hasExportableBody(
        selectedFullRequest.requestBody,
        selectedFullRequest.requestBodyTruncated
      );
    }
    if (focusedSection === SECTION_RESPONSE_BODY) {
      return hasExportableBody(
        selectedFullRequest.responseBody,
        selectedFullRequest.responseBodyTruncated
      );
    }
    return false;
  }, [selectedFullRequest, activePanel, focusedSection]);

  // Determine if the currently focused body section contains binary content
  const currentBodyIsBinary = useMemo(() => {
    if (!selectedFullRequest || activePanel !== "accordion") return false;

    if (focusedSection === SECTION_REQUEST_BODY) {
      return isBinaryContent(
        selectedFullRequest.requestBody,
        selectedFullRequest.requestHeaders["content-type"]
      ).isBinary;
    }
    if (focusedSection === SECTION_RESPONSE_BODY) {
      return isBinaryContent(
        selectedFullRequest.responseBody,
        selectedFullRequest.responseHeaders?.["content-type"]
      ).isBinary;
    }
    return false;
  }, [selectedFullRequest, activePanel, focusedSection]);

  // Handle export action from modal
  const handleExport = useCallback(
    async (action: ExportAction, customPath?: string) => {
      if (!selectedFullRequest || !savingBodyType) return;

      const isRequestBody = savingBodyType === "request";
      const body = isRequestBody ? selectedFullRequest.requestBody : selectedFullRequest.responseBody;
      const contentType = isRequestBody
        ? selectedFullRequest.requestHeaders["content-type"]
        : selectedFullRequest.responseHeaders?.["content-type"];

      if (!body) {
        showStatus("No body to export");
        setShowSaveModal(false);
        setSavingBodyType(null);
        return;
      }

      if (action === "clipboard") {
        const bodyIsBinary = isBinaryContent(body, contentType).isBinary;
        if (bodyIsBinary) {
          showStatus("Cannot copy binary content to clipboard — use a file export option");
        } else {
          try {
            await copyToClipboard(body.toString("utf-8"));
            showStatus("Body copied to clipboard");
          } catch {
            showStatus("Failed to copy to clipboard");
          }
        }
        setShowSaveModal(false);
        setSavingBodyType(null);
        return;
      }

      if (action === "open-external") {
        const filename = generateFilename(selectedFullRequest.id, contentType, selectedFullRequest.url);
        const result = await openInExternalApp(body, filename);
        showStatus(result.success ? result.message : `Error: ${result.message}`);
        setShowSaveModal(false);
        setSavingBodyType(null);
        return;
      }

      // File save actions: exports, downloads, custom
      const result = await saveBody(
        body,
        selectedFullRequest.id,
        contentType,
        selectedFullRequest.url,
        action,
        customPath
      );

      showStatus(result.success ? result.message : `Error: ${result.message}`);
      setShowSaveModal(false);
      setSavingBodyType(null);
    },
    [selectedFullRequest, savingBodyType, saveBody, showStatus]
  );

  // Handle keyboard input (only when raw mode is supported, i.e. running in a TTY)
  useInput(
    (input, key) => {
      // Navigation - behaviour depends on active panel
      if (input === "j" || key.downArrow) {
        if (activePanel === "list") {
          setSelectedIndex((prev) => Math.min(prev + 1, requests.length - 1));
        } else {
          // Navigate sections in accordion
          setFocusedSection((prev) => Math.min(prev + 1, 3));
        }
      } else if (input === "k" || key.upArrow) {
        if (activePanel === "list") {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else {
          // Navigate sections in accordion
          setFocusedSection((prev) => Math.max(prev - 1, 0));
        }
      } else if (input === "g" && !key.shift) {
        // Jump to first item/section
        if (activePanel === "list") {
          setSelectedIndex(0);
        } else {
          setFocusedSection(SECTION_REQUEST);
        }
      } else if (input === "G") {
        // Jump to last item/section
        if (activePanel === "list") {
          setSelectedIndex(Math.max(0, requestsLengthRef.current - 1));
        } else {
          setFocusedSection(SECTION_RESPONSE_BODY);
        }
      } else if (input === "u" && key.ctrl) {
        // Half-page up (list only)
        if (activePanel === "list") {
          const halfPage = Math.floor(contentHeightRef.current / 2);
          setSelectedIndex((prev) => Math.max(prev - halfPage, 0));
        }
      } else if (input === "d" && key.ctrl) {
        // Half-page down (list only)
        if (activePanel === "list") {
          const halfPage = Math.floor(contentHeightRef.current / 2);
          setSelectedIndex((prev) => Math.min(prev + halfPage, requestsLengthRef.current - 1));
        }
      } else if (key.tab) {
        // Tab cycles through all 5 panels: 1 (list), 2, 3, 4, 5 (accordion sections)
        if (key.shift) {
          // Shift+Tab cycles backwards
          if (activePanel === "accordion") {
            if (focusedSection > SECTION_REQUEST) {
              setFocusedSection((prev) => prev - 1);
            } else {
              setActivePanel("list");
            }
          } else {
            setActivePanel("accordion");
            setFocusedSection(SECTION_RESPONSE_BODY);
          }
        } else {
          // Tab cycles forwards
          if (activePanel === "list") {
            setActivePanel("accordion");
            setFocusedSection(SECTION_REQUEST);
          } else {
            // Cycle through accordion sections, then back to list
            if (focusedSection < SECTION_RESPONSE_BODY) {
              setFocusedSection((prev) => prev + 1);
            } else {
              setActivePanel("list");
            }
          }
        }
      } else if (input === "1") {
        setActivePanel("list");
      } else if (input === "2") {
        setActivePanel("accordion");
        setFocusedSection(SECTION_REQUEST);
      } else if (input === "3") {
        setActivePanel("accordion");
        setFocusedSection(SECTION_REQUEST_BODY);
      } else if (input === "4") {
        setActivePanel("accordion");
        setFocusedSection(SECTION_RESPONSE);
      } else if (input === "5") {
        setActivePanel("accordion");
        setFocusedSection(SECTION_RESPONSE_BODY);
      }

      // Toggle section expansion with Enter
      else if (key.return && activePanel === "accordion") {
        handleSectionToggle(focusedSection);
      }

      // Actions
      else if (input === "q") {
        exit();
      } else if (input === "r") {
        void refresh();
        showStatus("Refreshing...");
      } else if (input === "c") {
        if (selectedFullRequest) {
          void exportCurl(selectedFullRequest).then((result) => {
            showStatus(result.success ? result.message : `Error: ${result.message}`);
          });
        } else {
          showStatus("No request selected");
        }
      } else if (input === "h") {
        if (requests.length > 0) {
          showStatus("Exporting HAR...");
          void getAllFullRequests().then((fullRequests) => {
            const result = exportHar(fullRequests);
            showStatus(result.success ? result.message : `Error: ${result.message}`);
          });
        } else {
          showStatus("No requests to export");
        }
      } else if (input === "u" && !key.ctrl) {
        const newShowFullUrl = !showFullUrl;
        setShowFullUrl(newShowFullUrl);
        showStatus(newShowFullUrl ? "Showing full URL" : "Showing path only");
      } else if (input === "?") {
        setShowHelp(true);
      } else if (input === "i") {
        setShowInfo(true);
      } else if (input === "/") {
        setShowFilter(true);
      } else if (input === "y") {
        // Copy body to clipboard
        if (activePanel === "accordion" && (focusedSection === SECTION_REQUEST_BODY || focusedSection === SECTION_RESPONSE_BODY)) {
          if (!currentBodyIsExportable) {
            showStatus("No body to copy");
          } else if (currentBodyIsBinary) {
            showStatus("Cannot copy binary content — use 's' to export");
          } else {
            const isReqBody = focusedSection === SECTION_REQUEST_BODY;
            const body = isReqBody ? selectedFullRequest?.requestBody : selectedFullRequest?.responseBody;
            if (body) {
              void copyToClipboard(body.toString("utf-8")).then(
                () => showStatus("Body copied to clipboard"),
                () => showStatus("Failed to copy to clipboard")
              );
            }
          }
        }
      } else if (input === "s") {
        // Export body content
        if (currentBodyIsExportable) {
          setSavingBodyType(focusedSection === SECTION_REQUEST_BODY ? "request" : "response");
          setShowSaveModal(true);
        } else if (activePanel === "accordion" && (focusedSection === SECTION_REQUEST_BODY || focusedSection === SECTION_RESPONSE_BODY)) {
          showStatus("No body to export");
        }
      }
    },
    { isActive: (__testEnableInput || isRawModeSupported === true) && !showSaveModal && !showHelp && !showInfo && !showFilter },
  );

  // Calculate layout
  const listWidth = Math.floor(columns * 0.4);
  const accordionWidth = columns - listWidth;
  // Status bar takes 2 rows (border line + content line), filter bar takes 2 rows when visible
  const filterBarHeight = showFilter ? 2 : 0;
  const contentHeight = rows - 2 - filterBarHeight;

  // Keep selection in bounds when requests change
  React.useEffect(() => {
    if (selectedIndex >= requests.length && requests.length > 0) {
      setSelectedIndex(requests.length - 1);
    }
  }, [requests.length, selectedIndex]);

  // Auto-scroll list view when selection moves outside visible area
  React.useEffect(() => {
    const visibleHeight = Math.max(1, contentHeight - 2);
    if (selectedIndex < listScrollOffset) {
      setListScrollOffset(selectedIndex);
    } else if (selectedIndex >= listScrollOffset + visibleHeight) {
      setListScrollOffset(selectedIndex - visibleHeight + 1);
    }
  }, [selectedIndex, contentHeight, listScrollOffset]);

  // Terminal size check — re-evaluates on resize via useStdoutDimensions
  if (columns < MIN_TERMINAL_COLUMNS || rows < MIN_TERMINAL_ROWS) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height={rows} width={columns}>
        <Text color="red" bold>Terminal too small</Text>
        <Text> </Text>
        <Text>Current: {columns}x{rows}</Text>
        <Text>Required: {MIN_TERMINAL_COLUMNS}x{MIN_TERMINAL_ROWS}</Text>
        <Text> </Text>
        <Text dimColor>Please resize your terminal.</Text>
      </Box>
    );
  }

  // Loading state
  if (isLoading && requests.length === 0) {
    return (
      <Box flexDirection="column" height={rows}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text color="cyan">{spinnerFrame}</Text>
          <Text> Loading...</Text>
        </Box>
        <StatusBar />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" height={rows}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text color="red">Error: {error}</Text>
        </Box>
        <StatusBar message="Press 'q' to quit, 'r' to retry" />
      </Box>
    );
  }

  // Export modal - full screen replacement (terminals don't support true overlays)
  if (showSaveModal && selectedFullRequest && savingBodyType) {
    const isRequestBody = savingBodyType === "request";
    const body = isRequestBody ? selectedFullRequest.requestBody : selectedFullRequest.responseBody;
    const contentType = isRequestBody
      ? selectedFullRequest.requestHeaders["content-type"]
      : selectedFullRequest.responseHeaders?.["content-type"];
    const filename = generateFilename(selectedFullRequest.id, contentType, selectedFullRequest.url);
    const fileSize = formatSize(body?.length);
    const bodyIsBinary = isBinaryContent(body, contentType).isBinary;

    return (
      <ExportModal
        filename={filename}
        fileSize={fileSize}
        isBinary={bodyIsBinary}
        width={columns}
        height={rows}
        onExport={(action, customPath) => void handleExport(action, customPath)}
        onClose={() => {
          setShowSaveModal(false);
          setSavingBodyType(null);
        }}
        isActive={__testEnableInput || isRawModeSupported === true}
      />
    );
  }

  // Info modal - full screen replacement
  if (showInfo) {
    return (
      <InfoModal
        proxyPort={proxyPort}
        caCertPath={caCertPath}
        width={columns}
        height={rows}
        onClose={() => setShowInfo(false)}
        isActive={__testEnableInput || isRawModeSupported === true}
      />
    );
  }

  // Help modal - full screen replacement
  if (showHelp) {
    return (
      <HelpModal
        width={columns}
        height={rows}
        onClose={() => setShowHelp(false)}
        isActive={__testEnableInput || isRawModeSupported === true}
      />
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      {/* Main content */}
      <Box flexDirection="row" height={contentHeight}>
        <RequestList
          ref={listPanelRef}
          requests={requests}
          selectedIndex={selectedIndex}
          isActive={activePanel === "list"}
          isHovered={hoveredPanel === "list"}
          width={listWidth}
          height={contentHeight}
          showFullUrl={showFullUrl}
          onItemClick={handleItemClick}
          scrollOffset={listScrollOffset}
        />
        <AccordionPanel
          ref={accordionPanelRef}
          request={selectedFullRequest}
          isActive={activePanel === "accordion"}
          width={accordionWidth}
          height={contentHeight}
          focusedSection={focusedSection}
          expandedSections={expandedSections}
        />
      </Box>

      {/* Filter bar */}
      {showFilter && (
        <FilterBar
          isActive={(__testEnableInput || isRawModeSupported === true) && showFilter}
          filter={filter}
          onFilterChange={handleFilterChange}
          onClose={() => setShowFilter(false)}
          width={columns}
        />
      )}

      {/* Status bar */}
      <StatusBar
        message={statusMessage}
        filterActive={isFilterActive(filter)}
        filterOpen={showFilter}
        activePanel={activePanel}
        hasSelection={selectedFullRequest !== null}
        hasRequests={requests.length > 0}
        onBodySection={currentBodyIsExportable}
      />
    </Box>
  );
}

export function App(props: AppProps): React.ReactElement {
  return (
    <MouseProvider>
      <AppContent {...props} />
    </MouseProvider>
  );
}
