#!/bin/sh

# Build script for 1MCP Agent
# This script handles the complex build command logic

set -e

echo "🔨 Building 1MCP Agent..."

# Avoid shipping stale files from removed sources or renamed frontend assets.
rm -rf build

# Compile TypeScript
echo "📦 Compiling TypeScript..."
pnpm exec tsc --project tsconfig.build.json

# Resolve path aliases
echo "🔗 Resolving path aliases..."
pnpm exec tsc-alias -p tsconfig.build.json

# Build Admin Console SPA
echo "🖥️ Building Admin Console SPA..."
pnpm exec tsc --noEmit --project web/admin/tsconfig.json
pnpm exec tsc --noEmit --project web/admin/tsconfig.vite.json
pnpm exec vite build --config web/admin/vite.config.ts

# Make the built file executable
echo "🔧 Making build/index.js executable..."
node -e "require('fs').chmodSync('build/index.js', '755')"

echo "✅ Build completed successfully!"
