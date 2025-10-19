#!/bin/bash

# Development start script for 1MCP Agent
# This script handles the complex dev command logic

set -e

echo "🚀 Starting 1MCP Agent in development mode..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Copying from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ .env file created from .env.example"
    else
        echo "❌ .env.example file not found. Please create a .env file manually."
        exit 1
    fi
fi

# Start TypeScript compilation in watch mode and nodemon for auto-restart
concurrently \
    "tsc --watch --project tsconfig.build.json" \
    "nodemon --watch build --delay 2s --exec 'tsc-alias -p tsconfig.build.json && node --env-file=.env build/index.js'"
