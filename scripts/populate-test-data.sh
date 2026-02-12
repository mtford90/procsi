#!/usr/bin/env bash
#
# Populate procsi with real test requests for development/demo purposes.
# This script clears existing data, starts the daemon, makes various HTTP
# requests through the proxy, and then stops the daemon.
#
# Usage: ./scripts/populate-test-data.sh
#

set -euo pipefail

# Colours for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No colour

# Get the project root (directory containing this script's parent)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PROCSI_DIR="$PROJECT_ROOT/.procsi"

echo -e "${BLUE}=== procsi Test Data Population Script ===${NC}"
echo ""

# Step 1: Clean out existing data
echo -e "${YELLOW}Step 1: Cleaning existing .procsi directory...${NC}"
if [ -d "$PROCSI_DIR" ]; then
    # Stop daemon if running
    if [ -f "$PROCSI_DIR/daemon.pid" ]; then
        echo "  Stopping existing daemon..."
        cd "$PROJECT_ROOT" && node dist/cli/index.js stop 2>/dev/null || true
    fi

    echo "  Removing $PROCSI_DIR..."
    rm -rf "$PROCSI_DIR"
    echo -e "  ${GREEN}Cleaned!${NC}"
else
    echo "  No existing .procsi directory found."
fi
echo ""

# Step 2: Build the project (ensure we have latest code)
echo -e "${YELLOW}Step 2: Building project...${NC}"
cd "$PROJECT_ROOT"
npm run build
echo -e "${GREEN}Build complete!${NC}"
echo ""

# Step 3: Start the daemon and get proxy settings
echo -e "${YELLOW}Step 3: Starting procsi daemon...${NC}"
cd "$PROJECT_ROOT"

# Run intercept command and capture the environment variables
INTERCEPT_OUTPUT=$(node dist/cli/index.js intercept 2>&1)

# Extract the proxy URL and CA cert path from the output
eval "$INTERCEPT_OUTPUT"

echo "  Proxy URL: $HTTP_PROXY"
echo "  CA Cert: $NODE_EXTRA_CA_CERTS"
echo -e "  ${GREEN}Daemon started!${NC}"
echo ""

# Step 4: Make various HTTP requests through the proxy
echo -e "${YELLOW}Step 4: Making test requests...${NC}"

# Helper function to make a request and report status
make_request() {
    local method="$1"
    local url="$2"
    local description="$3"
    shift 3

    printf "  %-50s " "$description"

    if curl -s -o /dev/null -w "%{http_code}" \
        --proxy "$HTTP_PROXY" \
        --cacert "$NODE_EXTRA_CA_CERTS" \
        -X "$method" \
        "$@" \
        "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
}

# Simple HTML pages
echo ""
echo -e "  ${BLUE}--- HTML Responses ---${NC}"
make_request GET "https://example.com" "Simple HTML page (example.com)"
make_request GET "https://httpbin.org/html" "HTML sample page (httpbin)"

# JSON responses
echo ""
echo -e "  ${BLUE}--- JSON Responses ---${NC}"
make_request GET "https://jsonplaceholder.typicode.com/posts" "JSON list (posts)"
make_request GET "https://jsonplaceholder.typicode.com/users/1" "JSON object (single user)"
make_request GET "https://httpbin.org/json" "JSON sample (httpbin)"
make_request GET "https://api.github.com/users/octocat" "GitHub API (public user)"

# POST requests
echo ""
echo -e "  ${BLUE}--- POST Requests ---${NC}"
make_request POST "https://httpbin.org/post" "POST with JSON body" \
    -H "Content-Type: application/json" \
    -d '{"name": "Test User", "email": "test@example.com"}'
make_request POST "https://httpbin.org/post" "POST with form data" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=testuser&password=secret123"

# Headers inspection
echo ""
echo -e "  ${BLUE}--- Headers ---${NC}"
make_request GET "https://httpbin.org/headers" "Headers inspection" \
    -H "X-Custom-Header: hello-procsi" \
    -H "Authorization: Bearer test-token-123"

# Various status codes
echo ""
echo -e "  ${BLUE}--- Status Codes ---${NC}"
make_request GET "https://httpbin.org/status/201" "201 Created"
make_request GET "https://httpbin.org/status/404" "404 Not Found"
make_request GET "https://httpbin.org/status/500" "500 Server Error"

# Other content types
echo ""
echo -e "  ${BLUE}--- Other Content Types ---${NC}"
make_request GET "https://httpbin.org/xml" "XML response"

# Binary content (images, etc.) - for testing binary detection
echo ""
echo -e "  ${BLUE}--- Binary Content ---${NC}"
make_request GET "https://httpbin.org/image/png" "PNG image"
make_request GET "https://httpbin.org/image/jpeg" "JPEG image"
make_request GET "https://httpbin.org/image/webp" "WebP image"
make_request GET "https://httpbin.org/image/svg" "SVG image (text-based)"
make_request GET "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.pdf" "PDF document"
make_request GET "https://httpbin.org/bytes/8192" "Random bytes (8KB)"

# Additional useful requests
echo ""
echo -e "  ${BLUE}--- Additional Requests ---${NC}"
make_request GET "https://httpbin.org/get?foo=bar&baz=qux" "GET with query params"
make_request PUT "https://httpbin.org/put" "PUT request" \
    -H "Content-Type: application/json" \
    -d '{"id": 1, "updated": true}'
make_request DELETE "https://httpbin.org/delete" "DELETE request"
make_request PATCH "https://httpbin.org/patch" "PATCH request" \
    -H "Content-Type: application/json" \
    -d '{"partial": "update"}'

# Bulk requests for scroll testing
echo ""
echo -e "  ${BLUE}--- Bulk Requests (for scroll testing) ---${NC}"
for i in {1..10}; do
    make_request GET "https://jsonplaceholder.typicode.com/posts/$i" "Post #$i"
done
for i in {1..10}; do
    make_request GET "https://jsonplaceholder.typicode.com/users/$i" "User #$i"
done
for i in {1..5}; do
    make_request GET "https://jsonplaceholder.typicode.com/comments/$i" "Comment #$i"
done
for i in {1..5}; do
    make_request GET "https://jsonplaceholder.typicode.com/albums/$i" "Album #$i"
done
make_request GET "https://httpbin.org/delay/1" "Delayed response (1s)"
make_request GET "https://httpbin.org/bytes/1024" "Random bytes (1KB)"
make_request GET "https://httpbin.org/bytes/4096" "Random bytes (4KB)"
make_request GET "https://httpbin.org/uuid" "Random UUID"
make_request GET "https://httpbin.org/user-agent" "User agent echo"
make_request GET "https://httpbin.org/ip" "IP address"

echo ""
echo -e "${GREEN}=== Complete! ===${NC}"
echo ""
echo "Test data has been populated. You can now run:"
echo ""
echo -e "  ${BLUE}procsi tui${NC}       # Open the TUI to inspect requests"
echo -e "  ${BLUE}procsi status${NC}    # Check daemon status"
echo -e "  ${BLUE}procsi daemon stop${NC}  # Stop the daemon"
echo ""
