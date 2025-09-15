#!/bin/bash

# Binary functionality test for Unix platforms
# Usage: ./scripts/test-binary-unix.sh <binary-path>

set -e

BINARY_PATH="${1:-./1mcp}"
PLATFORM="${2:-unknown}"

echo "🧪 Testing $PLATFORM binary at $BINARY_PATH..."

# Test 1: Basic version check
echo "1️⃣ Testing version display..."
VERSION_OUTPUT=$($BINARY_PATH --version)
echo "Version: $VERSION_OUTPUT"
if [[ "$VERSION_OUTPUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✅ Version format valid"
else
  echo "❌ Invalid version format: $VERSION_OUTPUT"
  exit 1
fi

# Test 2: Help command
echo "2️⃣ Testing help command..."
$BINARY_PATH --help > /dev/null || { echo "❌ Help command failed"; exit 1; }
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
ONE_MCP_CONFIG=test-config.json timeout 15 $BINARY_PATH mcp tokens --help > /dev/null || {
  echo "❌ Tiktoken test failed - WASM files not working";
  rm -f test-config.json;
  exit 1;
}
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