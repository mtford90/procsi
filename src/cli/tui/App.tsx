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
import { InterceptorLogModal } from "./components/InterceptorLogModal.js";
import { InfoBar } from "./components/InfoBar.js";
import { isFilterActive } from "./utils/filters.js";
import { isJsonContent } from "./utils/content-type.js";
import { JsonExplorerModal } from "./components/JsonExplorerModal.js";
import { TextViewerModal } from "./components/TextViewerModal.js";
import { useInterceptorEvents } from "./hooks/useInterceptorEvents.js";
import { findProjectRoot, getProcsiPaths, readProxyPort } from "../../shared/project.js";
import { loadConfig } from "../../shared/config.js";
import type { BodySearchOptions, CapturedRequest, RequestFilter } from "../../shared/types.js";

interface AppProps {
  /** Enable keyboard input in tests (bypasses TTY check) */
  __testEnableInput?: boolean;
  /** Override project root directory (from --dir flag) */
  projectRoot?: string;
}

type Panel = "list" | "accordion";

export const MIN_TERMINAL_COLUMNS = 60;
export const MIN_TERMINAL_ROWS = 10;
const SHORT_REQUEST_ID_LENGTH = 7;

function AppContent({ __testEnableInput, projectRoot }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [columns, rows] = useStdoutDimensions();

  // Load project config once for pollInterval
  const config = useMemo(() => {
    const root = projectRoot ?? findProjectRoot();
    return root ? loadConfig(root) : undefined;
  }, [projectRoot]);

  // Filter state
  const [filter, setFilter] = useState<RequestFilter>({});
  const [bodySearch, setBodySearch] = useState<BodySearchOptions | undefined>(undefined);
  const [showFilter, setShowFilter] = useState(false);

  const {
    requests,
    isLoading,
    error,
    refresh,
    getFullRequest,
    getAllFullRequests,
    replayRequest = async () => {
      throw new Error("Replay is not available");
    },
    toggleSaved,
    clearRequests,
  } = useRequests({
    filter,
    bodySearch,
    projectRoot,
    pollInterval: config?.pollInterval,
  });
  const interceptorEvents = useInterceptorEvents({
    projectRoot,
    pollInterval: config?.pollInterval,
  });
  const startTime = useMemo(() => Date.now(), []);
  const { exportCurl, exportHar } = useExport();
  const { saveBody } = useBodyExport();
  const spinnerFrame = useSpinner(isLoading && requests.length === 0);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activePanel, setActivePanel] = useState<Panel>("list");
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [showFullUrl, setShowFullUrl] = useState(false);
  const [hoveredPanel, setHoveredPanel] = useState<Panel | null>(null);
  const [listScrollOffset, setListScrollOffset] = useState(0);

  // Accordion state — whichever section is focused is expanded (single-expand accordion)
  const [focusedSection, setFocusedSection] = useState(SECTION_REQUEST);

  // Help modal state
  const [showHelp, setShowHelp] = useState(false);

  // Info modal state
  const [showInfo, setShowInfo] = useState(false);

  // Interceptor log modal state
  const [showInterceptorLog, setShowInterceptorLog] = useState(false);

  // Clear confirmation state — when true, the next 'y' press confirms the clear
  const [pendingClear, setPendingClear] = useState(false);

  // Replay confirmation state — stores the request ID awaiting confirmation
  const [pendingReplayId, setPendingReplayId] = useState<string | null>(null);

  // Proxy details for info modal (one-time sync read)
  const proxyPort = useMemo(() => {
    const root = projectRoot ?? findProjectRoot();
    return root ? readProxyPort(root) : undefined;
  }, [projectRoot]);

  const caCertPath = useMemo(() => {
    const root = projectRoot ?? findProjectRoot();
    return root ? getProcsiPaths(root).caCertFile : "";
  }, [projectRoot]);

  // Save modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savingBodyType, setSavingBodyType] = useState<"request" | "response" | null>(null);

  // JSON explorer modal state
  const [showJsonExplorer, setShowJsonExplorer] = useState(false);
  const [jsonExplorerData, setJsonExplorerData] = useState<{
    data: unknown;
    title: string;
    contentType: string;
    bodySize: number;
  } | null>(null);

  // Text viewer modal state
  const [showTextViewer, setShowTextViewer] = useState(false);
  const [textViewerData, setTextViewerData] = useState<{
    text: string;
    title: string;
    contentType: string;
    bodySize: number;
  } | null>(null);

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

  // Stores the filter state at the moment the filter bar opens, so Escape can revert
  const preOpenFilterRef = useRef<RequestFilter>({});
  const preOpenBodySearchRef = useRef<BodySearchOptions | undefined>(undefined);

  // Handle filter change from the filter bar
  const handleFilterChange = useCallback((newFilter: RequestFilter) => {
    setFilter(newFilter);
    setSelectedIndex(0);
  }, []);

  const handleBodySearchChange = useCallback((nextBodySearch: BodySearchOptions | undefined) => {
    setBodySearch(nextBodySearch);
    setSelectedIndex(0);
  }, []);

  // Handle filter cancel — revert to pre-open state
  const handleFilterCancel = useCallback(() => {
    setFilter(preOpenFilterRef.current);
    setBodySearch(preOpenBodySearchRef.current);
    setSelectedIndex(0);
    setShowFilter(false);
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
      // Handle replay confirmation — any key other than 'y' cancels
      if (pendingReplayId) {
        const replayId = pendingReplayId;
        setPendingReplayId(null);
        if (input === "y") {
          showStatus("Replaying...");
          void replayRequest(replayId)
            .then((newRequestId) => {
              showStatus(
                newRequestId
                  ? `Replayed as ${newRequestId.slice(0, SHORT_REQUEST_ID_LENGTH)}`
                  : "Failed to replay"
              );
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "Unknown error";
              showStatus(`Failed to replay: ${message}`);
            });
        } else {
          setStatusMessage(undefined);
        }
        return;
      }

      // Handle clear confirmation — any key other than 'y' cancels
      if (pendingClear) {
        setPendingClear(false);
        if (input === "y") {
          void clearRequests().then((success) => {
            showStatus(success ? "Requests cleared (bookmarks preserved)" : "Failed to clear requests");
          });
        } else {
          setStatusMessage(undefined);
        }
        return;
      }

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

      // Open viewer on body sections — JSON explorer for JSON, text viewer for other text
      else if (key.return && activePanel === "accordion") {
        const isBodySection =
          focusedSection === SECTION_REQUEST_BODY || focusedSection === SECTION_RESPONSE_BODY;

        if (isBodySection) {
          const isReqBody = focusedSection === SECTION_REQUEST_BODY;
          const body = isReqBody
            ? selectedFullRequest?.requestBody
            : selectedFullRequest?.responseBody;
          const ct = isReqBody
            ? selectedFullRequest?.requestHeaders["content-type"]
            : selectedFullRequest?.responseHeaders?.["content-type"];

          if (body && body.length > 0) {
            const viewerTitle = isReqBody ? "Request Body" : "Response Body";

            if (isJsonContent(ct)) {
              try {
                const parsed = JSON.parse(body.toString("utf-8")) as unknown;
                setJsonExplorerData({
                  data: parsed,
                  title: viewerTitle,
                  contentType: ct ?? "",
                  bodySize: body.length,
                });
                setShowJsonExplorer(true);
              } catch {
                // Invalid JSON — fall through to text viewer
                setTextViewerData({
                  text: body.toString("utf-8"),
                  title: viewerTitle,
                  contentType: ct ?? "",
                  bodySize: body.length,
                });
                setShowTextViewer(true);
              }
            } else if (!isBinaryContent(body, ct).isBinary) {
              setTextViewerData({
                text: body.toString("utf-8"),
                title: viewerTitle,
                contentType: ct ?? "",
                bodySize: body.length,
              });
              setShowTextViewer(true);
            }
            // Binary content — no action
          }
        }
      }

      // Actions
      else if (input === "q") {
        exit();
      } else if (input === "r") {
        void refresh();
        showStatus("Refreshing...");
      } else if (input === "R") {
        if (selectedSummary) {
          setPendingReplayId(selectedSummary.id);
          showStatus("Replay selected request? (y to confirm, any key to cancel)");
        } else {
          showStatus("No request selected");
        }
      } else if (input === "c") {
        if (selectedFullRequest) {
          void exportCurl(selectedFullRequest).then((result) => {
            showStatus(result.success ? result.message : `Error: ${result.message}`);
          });
        } else {
          showStatus("No request selected");
        }
      } else if (input === "H") {
        if (requests.length > 0) {
          showStatus("Exporting HAR...");
          void getAllFullRequests().then((fullRequests) => {
            const result = exportHar(fullRequests);
            showStatus(result.success ? result.message : `Error: ${result.message}`);
          });
        } else {
          showStatus("No requests to export");
        }
      } else if (input === "f" && key.ctrl) {
        // Full-page down (list only)
        if (activePanel === "list") {
          const fullPage = contentHeightRef.current;
          setSelectedIndex((prev) => Math.min(prev + fullPage, requestsLengthRef.current - 1));
        }
      } else if (input === "b" && key.ctrl) {
        // Full-page up (list only)
        if (activePanel === "list") {
          const fullPage = contentHeightRef.current;
          setSelectedIndex((prev) => Math.max(prev - fullPage, 0));
        }
      } else if (input === "u" && !key.ctrl) {
        const newShowFullUrl = !showFullUrl;
        setShowFullUrl(newShowFullUrl);
        showStatus(newShowFullUrl ? "Showing full URL" : "Showing path only");
      } else if (input === "?") {
        setShowHelp(true);
      } else if (input === "i") {
        setShowInfo(true);
      } else if (input === "L") {
        setShowInterceptorLog(true);
      } else if (input === "/") {
        preOpenFilterRef.current = filter;
        preOpenBodySearchRef.current = bodySearch;
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
      } else if (input === "x" || input === "D") {
        // Clear all unsaved requests (with confirmation)
        if (requests.length > 0) {
          setPendingClear(true);
          showStatus("Clear all requests? (y to confirm, any key to cancel)");
        } else {
          showStatus("No requests to clear");
        }
      } else if (input === "b" && !key.ctrl) {
        // Toggle bookmark on selected request
        if (selectedSummary) {
          const currentlySaved = selectedSummary.saved === true;
          void toggleSaved(selectedSummary.id, currentlySaved).then((success) => {
            if (success) {
              showStatus(currentlySaved ? "Bookmark removed" : "Bookmarked");
            } else {
              showStatus("Failed to toggle bookmark");
            }
          });
        } else {
          showStatus("No request selected");
        }
      }
    },
    { isActive: (__testEnableInput || isRawModeSupported === true) && !showSaveModal && !showHelp && !showInfo && !showInterceptorLog && !showFilter && !showJsonExplorer && !showTextViewer },
  );

  // Calculate layout
  const listWidth = Math.floor(columns * 0.4);
  const accordionWidth = columns - listWidth;
  // Status bar takes 2 rows (border line + content line), InfoBar takes 1 row, filter bar takes 2 rows when visible
  const filterBarHeight = showFilter ? 2 : 0;
  const infoBarHeight = 1;
  const contentHeight = rows - 2 - infoBarHeight - filterBarHeight;

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
    // Intentionally omit listScrollOffset to allow free mouse wheel scrolling
  }, [selectedIndex, contentHeight]);

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

  // Interceptor log modal - full screen replacement
  if (showInterceptorLog) {
    return (
      <InterceptorLogModal
        events={interceptorEvents.events}
        width={columns}
        height={rows}
        onClose={() => setShowInterceptorLog(false)}
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

  // JSON explorer modal - full screen replacement
  if (showJsonExplorer && jsonExplorerData) {
    return (
      <JsonExplorerModal
        data={jsonExplorerData.data}
        title={jsonExplorerData.title}
        contentType={jsonExplorerData.contentType}
        bodySize={jsonExplorerData.bodySize}
        width={columns}
        height={rows}
        onClose={() => setShowJsonExplorer(false)}
        onStatus={showStatus}
        isActive={__testEnableInput || isRawModeSupported === true}
      />
    );
  }

  // Text viewer modal - full screen replacement
  if (showTextViewer && textViewerData) {
    return (
      <TextViewerModal
        text={textViewerData.text}
        title={textViewerData.title}
        contentType={textViewerData.contentType}
        bodySize={textViewerData.bodySize}
        width={columns}
        height={rows}
        onClose={() => setShowTextViewer(false)}
        onStatus={showStatus}
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
          searchTerm={bodySearch ? undefined : filter.search}
        />
        <AccordionPanel
          ref={accordionPanelRef}
          request={selectedFullRequest}
          isActive={activePanel === "accordion"}
          width={accordionWidth}
          height={contentHeight}
          focusedSection={focusedSection}
          expandedSections={new Set([focusedSection])}
        />
      </Box>

      {/* Filter bar */}
      {showFilter && (
        <FilterBar
          isActive={(__testEnableInput || isRawModeSupported === true) && showFilter}
          filter={filter}
          bodySearch={bodySearch}
          onFilterChange={handleFilterChange}
          onBodySearchChange={handleBodySearchChange}
          onClose={() => setShowFilter(false)}
          onCancel={handleFilterCancel}
          width={columns}
        />
      )}

      {/* Info bar */}
      <InfoBar
        interceptorErrorCount={interceptorEvents.counts.error}
        requestCount={requests.length}
        interceptorCount={interceptorEvents.interceptorCount}
        startTime={startTime}
        width={columns}
      />

      {/* Status bar */}
      <StatusBar
        message={statusMessage}
        filterActive={isFilterActive(filter) || bodySearch !== undefined}
        filterOpen={showFilter}
        activePanel={activePanel}
        hasSelection={selectedFullRequest !== null}
        hasRequests={requests.length > 0}
        onBodySection={currentBodyIsExportable}
        onViewableBodySection={currentBodyIsExportable && !currentBodyIsBinary}
        interceptorCount={interceptorEvents.interceptorCount}
        interceptorErrorCount={interceptorEvents.counts.error}
        hasEvents={interceptorEvents.totalEventCount > 0}
        width={columns}
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
