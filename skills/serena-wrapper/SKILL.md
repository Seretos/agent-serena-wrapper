---
name: serena-wrapper
description: >
  Navigate, understand, and edit code with Serena's symbol-aware MCP tools
  instead of reading or grepping whole files. Use when exploring or
  understanding an unfamiliar codebase, finding where a function/class/symbol
  is defined, finding all callers or references of a symbol, reading a single
  class or method body, tracing inheritance or locating interface
  implementations, or performing a consistent project-wide rename.
  Also use for questions like: "which providers does the project support",
  "which options are available", "where is X defined", "where is X
  implemented", "what does X do", "find all callers of X",
  "show me all usages of X", "list all implementations of X",
  "what classes implement interface X", "welche Provider unterstützt das
  Projekt", "welche Optionen gibt es", "wo wird X definiert",
  "wo ist X implementiert", "was macht X", "zeig mir alle Aufrufer von X",
  "zeig mir alle Verwendungen von X", "welche Klassen implementieren X".
---

# serena-wrapper

## What this skill is for

Use this skill whenever you need to navigate, understand, or safely modify an unfamiliar codebase. Reach for Serena's symbol-oriented tools — rather than `Read` or `Grep` — when you need to find all callers of a function, read a single class body without loading the entire file, trace inheritance hierarchies, locate implementations of an interface, or perform a rename that must be consistent across the codebase. Symbol-level queries return only the tokens you need, which keeps context usage low and answers precise.

## Mental model

Serena models a codebase as a **symbol graph**: files contain classes; classes contain methods and fields; references between symbols are tracked edges. When the MCP server starts, it activates the project at startup — the Claude Code variant uses `--project ${CLAUDE_PROJECT_DIR}` (the directory Claude Code is opened on), while the Codex variant uses `--project-from-cwd` (walking up from the process CWD to find `.serena/project.yml` or `.git`). Once a project is active, every symbol query operates against that graph rather than raw text.

Key concepts:

- **Project** — a root directory Serena has indexed. Must be active before any symbol query.
- **Symbol** — any named code entity: class, function, method, field, variable, module.
- **Active project** — the project currently loaded into the Serena session. This is resolved automatically at startup from the launch flags in the plugin manifest.
- **Symbol path** — a dotted or slash-delimited path that uniquely identifies a symbol, e.g. `mypackage.mymodule.MyClass.my_method`.

## Tool inventory

| Tool | Best for |
|---|---|
| `find_symbol` | Locate a symbol by name; returns its file, line, and symbol path. Pass `include_body=true` to retrieve the full source text of that symbol (class, function, method) without reading the surrounding file. |
| `find_referencing_symbols` | Find every call site or usage of a symbol across the entire project. |
| `find_implementations` | Navigate from an interface, abstract class, or protocol to the concrete classes that implement it. |
| `get_symbols_overview` | List the top-level symbols in a file — useful when you only know part of a name or want to survey a file's structure before drilling in. |
| `find_declaration` | Jump from a usage site to the symbol's declaration. |

## Patterns and recipes

### Read a class body without loading the whole file

1. Call `find_symbol` with the class name to get its symbol path.
2. Call `find_symbol` again with `include_body=true` on that symbol path.
3. Inspect methods by calling `find_symbol` with `include_body=true` on individual method symbol paths if you only need specific ones.

Do not call `Read` on the file just to see the class — `find_symbol` with `include_body=true` returns exactly the tokens you need.

### Find all callers of a function

1. Call `find_symbol` with the function name to confirm the symbol path.
2. Call `find_referencing_symbols` with that symbol path.
3. For each reference site returned, call `find_symbol` with `include_body=true` on the enclosing method symbol path if you need the surrounding context.

This is far more reliable than grepping for the function name as a string, which misses aliased imports and dynamic calls tracked in the symbol graph.

### Navigate from an interface to its implementation

1. Call `find_symbol` with the interface or abstract class name.
2. Call `find_implementations` with that symbol path.
3. For each concrete implementation returned, call `find_symbol` with `include_body=true` to read the override you care about.

Use this pattern when a caller holds a reference typed as an interface and you need to understand what actually runs at runtime.

## Pitfalls

- **Do not mix `Read`-on-file with `find_symbol(include_body=true)` for the same symbol.** Reading the whole file and then also fetching the symbol body doubles the token cost with no additional information. Pick one approach per symbol.
- **`get_symbols_overview` is for discovery, not for authoritative lookup.** It surveys a file's top-level symbols and may include entries you don't need. Always confirm the exact symbol path with `find_symbol` before passing it to `find_symbol(include_body=true)` or `find_referencing_symbols`.
- **Symbol paths are language- and project-specific.** Do not guess a symbol path — derive it from a `find_symbol` or `get_symbols_overview` response for the current project.
- **If the server reports "Serena MCP server not loaded" at startup, reconnect it.** This is a cold-start timing race: `uvx` builds Serena's cached environment before the first JSON-RPC byte, which can exceed the host's stdio handshake timeout on a fresh/empty cache. A reconnect (`/mcp` → reconnect, or reloading the plugin) starts the server cleanly because the environment is already built. The exact version pin (`serena-agent==1.5.3`) in the manifests makes this far less likely after the first run. See the README "Troubleshooting" section for details.
- **Empty `languages:` in `.serena/project.yml` disables all symbol tools silently.** When Serena first auto-creates `.serena/project.yml` in a new project it writes an empty `languages:` list; without a configured language no LSP starts and every symbol query returns nothing. The `serena-reminder-hook` auto-detects languages from source files on each hook invocation and patches `project.yml` in-place when the list is still empty. If no recognisable source files exist yet the hook emits a warning in `additionalContext` (containing the word `languages`) instead of failing silently. Once source files are present the fix is automatic — no manual editing required.
