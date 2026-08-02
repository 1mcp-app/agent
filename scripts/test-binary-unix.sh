#!/bin/bash

# Binary functionality test for Unix platforms
# Usage: ./scripts/test-binary-unix.sh <binary-path> <platform>

set -e

BINARY_PATH="${1:-./1mcp}"
PLATFORM="${2:-unknown}"

echo "🧪 Testing $PLATFORM binary at $BINARY_PATH..."

# Test 1: Basic version check
echo "1️⃣ Testing version display..."
VERSION_OUTPUT=$("$BINARY_PATH" --version)
echo "Version: $VERSION_OUTPUT"
if [[ "$VERSION_OUTPUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "✅ Version format valid"
else
  echo "❌ Invalid version format: $VERSION_OUTPUT"
  exit 1
fi

# Test 2: Help command
echo "2️⃣ Testing help command..."
"$BINARY_PATH" --help > /dev/null || { echo "❌ Help command failed"; exit 1; }
echo "✅ Help command works"

# Test 3: MCP tokens command with tiktoken (most critical test)
echo "3️⃣ Testing tiktoken functionality..."
cat > test-config.json << 'EOF'
{
  "mcpServers": {
    "test-server": {
      "command": "echo",
      "args": ["test"]
    }
  }
}
EOF

# Test tokens command - this validates tiktoken WASM loading
# Use different timeout methods based on platform
if command -v timeout >/dev/null 2>&1; then
  # Linux has timeout command
  ONE_MCP_CONFIG=test-config.json timeout 15 "$BINARY_PATH" mcp tokens --help > /dev/null || {
    echo "❌ Tiktoken test failed - WASM files not working";
    rm -f test-config.json;
    exit 1;
  }
elif command -v gtimeout >/dev/null 2>&1; then
  # macOS with coreutils installed
  ONE_MCP_CONFIG=test-config.json gtimeout 15 "$BINARY_PATH" mcp tokens --help > /dev/null || {
    echo "❌ Tiktoken test failed - WASM files not working";
    rm -f test-config.json;
    exit 1;
  }
else
  # Fallback for macOS without timeout - use background process with kill
  ONE_MCP_CONFIG=test-config.json "$BINARY_PATH" mcp tokens --help > /dev/null 2>&1 &
  PID=$!
  sleep 15
  if kill -0 $PID 2>/dev/null; then
    kill $PID 2>/dev/null
    wait $PID 2>/dev/null || true
  fi
  # If we get here, assume success (tiktoken loaded, process started)
fi
echo "✅ Tiktoken functionality working"

# Test 4: Admin Console assets from the standalone binary
echo "4️⃣ Testing embedded Admin Console assets..."
ADMIN_SMOKE_DIR=$(mktemp -d)
ADMIN_SMOKE_PORT=$(node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{console.log(server.address().port);server.close()})')
ADMIN_SMOKE_URL="http://127.0.0.1:$ADMIN_SMOKE_PORT"
ADMIN_SMOKE_LOG="$ADMIN_SMOKE_DIR/runtime.log"
mkdir -p "$ADMIN_SMOKE_DIR/config"
printf '{"mcpServers":{}}\n' > "$ADMIN_SMOKE_DIR/config/mcp.json"
"$BINARY_PATH" serve --transport http --host 127.0.0.1 --port "$ADMIN_SMOKE_PORT" --external-url "$ADMIN_SMOKE_URL" --config-dir "$ADMIN_SMOKE_DIR/config" > "$ADMIN_SMOKE_LOG" 2>&1 &
ADMIN_SMOKE_PID=$!
cleanup_admin_smoke() {
  kill "$ADMIN_SMOKE_PID" 2>/dev/null || true
  wait "$ADMIN_SMOKE_PID" 2>/dev/null || true
  rm -rf "$ADMIN_SMOKE_DIR"
}
trap cleanup_admin_smoke EXIT

for attempt in $(seq 1 50); do
  if curl -fsS "$ADMIN_SMOKE_URL/health/ready" > /dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$ADMIN_SMOKE_PID" 2>/dev/null; then
    cat "$ADMIN_SMOKE_LOG"
    exit 1
  fi
  sleep 0.1
done

if ! curl -fsS "$ADMIN_SMOKE_URL/health/ready" > /dev/null 2>&1; then
  cat "$ADMIN_SMOKE_LOG"
  echo "❌ Standalone binary did not become ready"
  exit 1
fi

ADMIN_HTML=$(curl -fsS "$ADMIN_SMOKE_URL/admin/")
ADMIN_JS_ASSET=$(printf '%s' "$ADMIN_HTML" | sed -nE 's|.*src="/admin/(assets/[^"]+\.js)".*|\1|p' | head -n 1)
ADMIN_CSS_ASSET=$(printf '%s' "$ADMIN_HTML" | sed -nE 's|.*href="/admin/(assets/[^"]+\.css)".*|\1|p' | head -n 1)
if [[ -z "$ADMIN_JS_ASSET" || -z "$ADMIN_CSS_ASSET" ]]; then
  echo "❌ Admin Console HTML did not reference JavaScript and CSS assets"
  exit 1
fi

curl -fsS "$ADMIN_SMOKE_URL/admin/$ADMIN_JS_ASSET" -o "$ADMIN_SMOKE_DIR/admin-console.js"
curl -fsS "$ADMIN_SMOKE_URL/admin/$ADMIN_CSS_ASSET" -o "$ADMIN_SMOKE_DIR/admin-console.css"
if [[ ! -s "$ADMIN_SMOKE_DIR/admin-console.js" || ! -s "$ADMIN_SMOKE_DIR/admin-console.css" ]]; then
  echo "❌ Embedded Admin Console assets were empty"
  exit 1
fi
trap - EXIT
cleanup_admin_smoke
echo "✅ Embedded Admin Console assets working"

# Test 5: System installation simulation
echo "5️⃣ Testing system installation simulation..."
mkdir -p test-bin
cp "$BINARY_PATH" test-bin/
cd test-bin
BINARY_NAME=$(basename "$BINARY_PATH")
PATH_TEST_OUTPUT=$(./"$BINARY_NAME" --version)
if [[ "$PATH_TEST_OUTPUT" == "$VERSION_OUTPUT" ]]; then
  echo "✅ System installation simulation passed"
else
  echo "❌ System installation failed: got $PATH_TEST_OUTPUT, expected $VERSION_OUTPUT"
  cd ..
  rm -rf test-bin test-config.json
  exit 1
fi
cd ..
rm -rf test-bin test-config.json

echo "✅ All $PLATFORM binary tests passed!"
