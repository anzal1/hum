#!/usr/bin/env bash
# Build dist/hum.mcpb, the one-click extension for Claude Desktop, with the official packer.
# Run from anywhere. It needs Node 18+ and downloads @anthropic-ai/mcpb with npx the first time.
# After packing it prints the SHA-256 that server.json needs for the MCP Registry.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist

# manifest.json and .mcpbignore at the repo root decide what goes in the bundle.
npx -y @anthropic-ai/mcpb validate manifest.json
npx -y @anthropic-ai/mcpb pack . dist/hum.mcpb
npx -y @anthropic-ai/mcpb info dist/hum.mcpb

echo
echo "SHA-256 for server.json (packages[0].fileSha256):"
if command -v shasum >/dev/null 2>&1; then shasum -a 256 dist/hum.mcpb; else sha256sum dist/hum.mcpb; fi
