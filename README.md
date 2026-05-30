# agent-serena-wrapper

A Claude Code **skill** plugin. Pairs the Serena MCP server with a skill so Claude works with code through token-efficient semantic operations instead of reading whole files.

This plugin bundles a headless Serena MCP server declared inline in both plugin manifests. When the skill is installed, the host agent launches Serena automatically via `uvx` — no manual server setup required. The `--project-from-cwd` flag means Serena detects the active project from the working directory automatically; no manual `activate_project` call is needed for standard repository layouts.

## Prerequisites

`uv` must be installed on the host machine. `uvx` (bundled with `uv`) is used to launch Serena on demand without a manual `pip install`.

Install `uv`: https://docs.astral.sh/uv/getting-started/installation/

## Install

```
/plugin marketplace add Seretos/agent-marketplace
/plugin install agent-serena-wrapper@agent-marketplace
```

## What the skill teaches

See `skills/serena-wrapper/SKILL.md` for the full content.
