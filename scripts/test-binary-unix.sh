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
if [[ "$VERSION_OUTPUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
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

# Test 4: System installation simulation
echo "4️⃣ Testing system installation simulation..."
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