# agent-serena-wrapper

A Claude Code **skill** plugin. Pairs the Serena MCP server with a skill so Claude works with code through token-efficient semantic operations instead of reading whole files.

This plugin bundles a headless Serena MCP server declared inline in both plugin manifests. When the skill is installed, the host agent launches Serena automatically via `uvx` — no manual server setup required. The Claude Code plugin passes `--project ${CLAUDE_PROJECT_DIR}` so Serena is rooted at the exact sub-repo Claude Code is opened on, which fixes monorepo layouts where the process CWD would resolve to the wrong root. The Codex plugin retains `--project-from-cwd` (CWD auto-detection) because Codex does not define `CLAUDE_PROJECT_DIR`. In either case no manual `activate_project` call is needed for standard repository layouts.

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

## PreToolUse reminder hook

This plugin ships a `hooks/hooks.json` that registers a `PreToolUse` hook
matching the `Read`, `Glob`, and `Grep` tools. When one of those tools fires,
the hook script (`scripts/serena-reminder-hook.mjs`) runs automatically.

**What it does:** It injects an `additionalContext` reminder — not a hard
block — telling the model that Serena MCP semantic tools (`find_symbol`,
`get_symbol_body`, `find_references`, etc.) are available and preferred for
code-understanding tasks. The tool call is always allowed through; only the
reminder text is injected.

**Scoping:** The hook first walks up from the working directory looking for
`.serena/project.yml`. If the marker is not found, the hook exits silently
and produces no output (full pass-through). This means the hook is a no-op
in repos that do not use Serena.

**Codex plugin:** unaffected — Codex uses a separate hook mechanism and its
`hooks/hooks.json` is independent of this one.
