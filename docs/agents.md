# hum in your coding agent

hum is a free music player. Your agent is the remote: it can play a song, start a mood station, pause, skip, set the volume and tell you which lyric line is being sung. The music itself plays in a hum browser tab, which opens the first time you ask for something. Click that tab once so the browser allows sound.

You need Node 18 or newer. Every install below runs the same command:

```bash
npx -y -p github:anzal1/hum hum-mcp
```

The first run downloads hum from GitHub, which takes a few seconds. If your agent times out on first start, install once and use the short command instead:

```bash
npm install -g github:anzal1/hum    # then the command is just: hum-mcp
```

Optional settings, as environment variables: `HUM_PORT` (default 3737) and `HUM_NO_OPEN=1` (never open the browser by itself).

On Windows, if an app cannot find `npx`, use `"command": "cmd"` and put `"/c", "npx"` at the start of `args`.

## Claude Code

```bash
claude mcp add --scope user hum -- npx -y -p github:anzal1/hum hum-mcp
```

Without `--scope user` it is added for the current project only. Check with `claude mcp list`. Docs: https://code.claude.com/docs/en/mcp

## Claude Desktop

**One click (extension).** Download `hum.mcpb` from the [latest release](https://github.com/anzal1/hum/releases/latest), then open Settings, Extensions, Advanced settings, Install Extension, and pick the file. Claude Desktop ships its own Node, so nothing else is needed. To build it yourself, run `scripts/pack-mcpb.sh` and use `dist/hum.mcpb`. Docs: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop

**Manual config.** Open Settings, Developer, Edit Config. The file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Add this, then quit and reopen Claude Desktop. This route needs Node on your machine. Docs: https://modelcontextprotocol.io/docs/develop/connect-local-servers

```json
{
  "mcpServers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

## Cursor

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=hum&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIi1wIiwiZ2l0aHViOmFuemFsMS9odW0iLCJodW0tbWNwIl19) (or paste the link into a browser address bar). The `config` value is the base64 of `{"command":"npx","args":["-y","-p","github:anzal1/hum","hum-mcp"]}`.

Or put this in `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "hum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

Docs: https://cursor.com/docs/context/mcp and https://cursor.com/docs/mcp/install-links

For a README button, use `[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=hum&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIi1wIiwiZ2l0aHViOmFuemFsMS9odW0iLCJodW0tbWNwIl19)`.

## VS Code (GitHub Copilot)

One command:

```bash
code --add-mcp "{\"name\":\"hum\",\"type\":\"stdio\",\"command\":\"npx\",\"args\":[\"-y\",\"-p\",\"github:anzal1/hum\",\"hum-mcp\"]}"
```

One click: [Install in VS Code](vscode:mcp/install?%7B%22name%22%3A%22hum%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22-p%22%2C%22github%3Aanzal1%2Fhum%22%2C%22hum-mcp%22%5D%7D). For Insiders, change `vscode:` to `vscode-insiders:`.

Or put this in `.vscode/mcp.json` in your project (or run "MCP: Open User Configuration" for all projects). Note the top-level key is `servers`, not `mcpServers`:

```json
{
  "servers": {
    "hum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

Docs: https://code.visualstudio.com/docs/agent-customization/mcp-servers and https://code.visualstudio.com/api/extension-guides/ai/mcp

## OpenAI Codex CLI

```bash
codex mcp add hum -- npx -y -p github:anzal1/hum hum-mcp
```

Or edit `~/.codex/config.toml` (a trusted project can use `.codex/config.toml`). The start timeout defaults to 10 seconds, which can be too short for the first download, so raise it:

```toml
[mcp_servers.hum]
command = "npx"
args = ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
startup_timeout_sec = 60
```

Docs: https://learn.chatgpt.com/docs/extend/mcp?surface=cli (the old address developers.openai.com/codex/mcp redirects there)

## Gemini CLI

```bash
gemini mcp add --scope user hum npx -- -y -p github:anzal1/hum hum-mcp
```

The `--` stops Gemini from reading `-y` and `-p` as its own flags. Or add this to `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project):

```json
{
  "mcpServers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

Docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md

## Windsurf (now Devin Desktop)

Windsurf was renamed Devin Desktop and its docs moved to docs.devin.ai. The classic Cascade agent reads `~/.codeium/windsurf/mcp_config.json` (Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`). Open it from the MCPs icon in the Cascade panel, then Configure:

```json
{
  "mcpServers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

The newer Devin Local agent uses the Devin CLI config instead (next section). Docs: https://docs.devin.ai/windsurf/plugins/cascade/mcp and https://docs.devin.ai/desktop/cascade/mcp

## Devin CLI

```bash
devin mcp add -s user hum -- npx -y -p github:anzal1/hum hum-mcp
```

That writes `~/.config/devin/mcp_config.json` (Windows: `%APPDATA%\devin\mcp_config.json`), using the same `mcpServers` JSON as above. Use `-s project` for `.devin/mcp_config.json`. Docs: https://docs.devin.ai/cli/extensibility/mcp/configuration

## Zed

Open the settings file ("zed: open settings file") and add this. Or go to Settings, AI, MCP Servers, Add Server, Add Local Server and enter the same command.

```json
{
  "context_servers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"],
      "env": {}
    }
  }
}
```

Docs: https://zed.dev/docs/ai/mcp

## GitHub Copilot CLI

Run `/mcp add`, choose STDIO, and enter `npx -y -p github:anzal1/hum hum-mcp` as the command with tools set to `*`. Or edit `~/.copilot/mcp-config.json`. The file says `local` where the form says STDIO:

```json
{
  "mcpServers": {
    "hum": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

Docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers

## opencode

Add to `opencode.json` in your project. The command is one array, not command plus args:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "hum": {
      "type": "local",
      "command": ["npx", "-y", "-p", "github:anzal1/hum", "hum-mcp"],
      "enabled": true
    }
  }
}
```

Docs: https://opencode.ai/docs/mcp-servers/

## Cline

Click the MCP Servers icon in Cline, open the Configure tab, choose Configure MCP Servers, and add this (the Cline CLI reads `~/.cline/mcp.json`):

```json
{
  "mcpServers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"],
      "disabled": false
    }
  }
}
```

Docs: https://docs.cline.bot/mcp/configuring-mcp-servers

## Kiro

Put this in `~/.kiro/settings/mcp.json` (all workspaces) or `.kiro/settings/mcp.json` (one workspace):

```json
{
  "mcpServers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

Docs: https://kiro.dev/docs/mcp/configuration/

## Amp

```bash
amp mcp add hum -- npx -y -p github:anzal1/hum hum-mcp
```

Or in `~/.config/amp/settings.json`:

```json
{
  "amp.mcpServers": {
    "hum": {
      "command": "npx",
      "args": ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    }
  }
}
```

Docs: https://ampcode.com/docs/customize/mcp

## Goose

Run `goose configure`, choose Add Extension, then Command-line Extension, and enter `npx -y -p github:anzal1/hum hum-mcp` with a timeout of 300. Or edit `~/.config/goose/config.yaml`:

```yaml
extensions:
  hum:
    name: hum
    type: stdio
    cmd: npx
    args: ["-y", "-p", "github:anzal1/hum", "hum-mcp"]
    enabled: true
    timeout: 300
```

Docs: https://goose-docs.ai/docs/getting-started/using-extensions

## Continue

Create `.continue/mcpServers/hum.yaml`. Continue also picks up the Claude or Cursor style JSON if you drop it in that folder.

```yaml
name: hum
version: 0.0.1
schema: v1
mcpServers:
  - name: hum
    type: stdio
    command: npx
    args:
      - "-y"
      - "-p"
      - "github:anzal1/hum"
      - "hum-mcp"
```

Docs: https://docs.continue.dev/customize/deep-dives/mcp

## Any other host

If it supports stdio MCP servers, give it the command `npx` with the arguments `-y -p github:anzal1/hum hum-mcp`. Hosts that cannot run MCP can post to the local server instead, see the README.

## Maintainers: bundle and registry

The Claude Desktop extension and the official MCP Registry entry both use one file, `hum.mcpb`, a zip of `mcp.js`, `server.js`, `api/`, `public/` and `bin/` described by `manifest.json` (spec 0.3, https://github.com/anthropics/mcpb/blob/main/MANIFEST.md). `.mcpbignore` keeps `desktop/`, `test/`, `og/`, `docs/` and `node_modules/` out. The registry only stores metadata and does not need hum on npm: a `mcpb` package can point at a GitHub release asset (https://modelcontextprotocol.io/registry/package-types).

Publishing steps (none of this has been run yet):

1. Make the version match in `package.json`, `manifest.json` and `server.json`, for example 0.1.0.
2. Build once: `scripts/pack-mcpb.sh`. It writes `dist/hum.mcpb` and prints its SHA-256. Do not rebuild after this point, since a rebuilt zip can hash differently.
3. Put that hash in `packages[0].fileSha256` in `server.json`, and check `identifier` is `https://github.com/anzal1/hum/releases/download/v0.1.0/hum.mcpb` for the same version. The identifier must contain "mcp", which `.mcpb` does.
4. Commit, tag and release with the same file: `gh release create v0.1.0 dist/hum.mcpb --title "hum 0.1.0" --notes "First release"`.
5. Install the publisher (`brew install mcp-publisher`, or the binary from https://github.com/modelcontextprotocol/registry/releases).
6. `mcp-publisher validate`, then `mcp-publisher login github` (finish the device code in the browser as `anzal1`), then `mcp-publisher publish`. The name `io.github.anzal1/hum` is allowed because it starts with your GitHub username.
7. Check: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.anzal1/hum"`.

Quickstart for reference: https://modelcontextprotocol.io/registry/quickstart. For each new version, repeat steps 1 to 6 with a new tag.
