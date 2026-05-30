# agent-serena-wrapper

A Claude Code **skill** plugin. Pairs the external Serena MCP server with a skill so Claude works with code through token-efficient semantic operations instead of reading whole files.

This plugin ships **only the skill content** — no binaries, no MCP server.

## Install

```
/plugin marketplace add Seretos/agent-marketplace
/plugin install agent-serena-wrapper@agent-marketplace
```

If the skill teaches Claude how to use a specific MCP, declare that MCP as a dependency in `.claude-plugin/plugin.json` (`dependencies` array). Claude Code will install/load it automatically.

## What the skill teaches

See `skills/serena-wrapper/SKILL.md` for the full content.
