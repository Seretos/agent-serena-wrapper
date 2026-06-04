# agent-serena-wrapper

A Claude Code **skill** plugin. Pairs the Serena MCP server with a skill so Claude works with code through token-efficient semantic operations instead of reading whole files.

This plugin bundles a headless Serena MCP server declared inline in both plugin manifests. When the skill is installed, the host agent launches Serena automatically via `uvx` — no manual server setup required. The Claude Code plugin passes `--project ${CLAUDE_PROJECT_DIR}` so Serena is rooted at the exact sub-repo Claude Code is opened on, which fixes monorepo layouts where the process CWD would resolve to the wrong root. The Codex plugin retains `--project-from-cwd` (CWD auto-detection) because Codex does not define `CLAUDE_PROJECT_DIR`. In either case no manual `activate_project` call is needed for standard repository layouts.

## Prerequisites

`uv` must be installed on the host machine. `uvx` (bundled with `uv`) is used to launch Serena on demand without a manual `pip install`. Serena is pinned to an exact version (`serena-agent==1.5.3`) in both manifests so `uvx` resolves the same cached environment on every start instead of re-checking the index for a newer release.

Install `uv`: https://docs.astral.sh/uv/getting-started/installation/

## Install

```
/plugin marketplace add Seretos/agent-marketplace
/plugin install agent-serena-wrapper@agent-marketplace
```

## What the skill teaches

See `skills/serena-wrapper/SKILL.md` for the full content.

## Troubleshooting

### "Serena MCP server not loaded" on startup

Occasionally the host reports that the Serena MCP server failed to load right
after launch, and a simple **reconnect** (`/mcp` → reconnect, or reloading the
plugin) fixes it immediately.

**Cause.** Serena is started headless via `uvx`, which builds/validates its
cached environment *before* Serena emits its first JSON-RPC byte. On a cold
start — first install, an empty/`uvx` cache, or first-time package download —
that setup can exceed the host's fixed stdio handshake timeout, so the host
gives up and marks the server as not loaded. A reconnect succeeds because by
then the environment is already built and the server starts instantly. This is
a startup-timing race, not a misconfiguration.

**What this plugin does.** Serena is pinned to an exact version
(`serena-agent==1.5.3`) in both manifests. An exact pin lets `uvx` reuse the
same cached tool environment on every start instead of querying the index for a
newer release, which removes the per-start resolution overhead and makes the
race far less likely once the environment is cached.

**The first cold start is unavoidable.** The very first launch with no cache
must still download and build the environment, which can be slow enough to trip
the timeout. If you see the error there, just **reconnect the MCP server** — it
will start cleanly because the environment is now cached. To warm the cache
ahead of time you can pre-run:

```
uvx --from serena-agent==1.5.3 serena --help
```

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
