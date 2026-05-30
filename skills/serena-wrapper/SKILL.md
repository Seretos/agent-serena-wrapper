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

Serena models a codebase as a **symbol graph**: files contain classes; classes contain methods and fields; references between symbols are tracked edges. When the MCP server starts with `--project-from-cwd`, it auto-detects the active project by walking up from the current working directory looking for `.serena/project.yml` or `.git`. Once a project is active, every symbol query operates against that graph rather than raw text.

Key concepts:

- **Project** — a root directory Serena has indexed. Must be active before any symbol query.
- **Symbol** — any named code entity: class, function, method, field, variable, module.
- **Active project** — the project currently loaded into the Serena session. With `--project-from-cwd` this is set automatically at startup; you do not call `activate_project` in normal flow.
- **Symbol path** — a dotted or slash-delimited path that uniquely identifies a symbol, e.g. `mypackage.mymodule.MyClass.my_method`.

## Tool inventory

| Tool | Best for |
|---|---|
| `find_symbol` | Locate a symbol by name; returns its file, line, and symbol path. |
| `get_symbol_body` | Retrieve the full source text of a single symbol (class, function, method) without reading the surrounding file. |
| `find_references` | Find every call site or usage of a symbol across the entire project. |
| `find_implementations` | Navigate from an interface, abstract class, or protocol to the concrete classes that implement it. |
| `search_symbols` | Fuzzy or prefix search across all symbol names — useful when you only know part of the name. |
| `activate_project` | Recovery only: explicitly activate a project by repo root path when auto-detection has failed. |

## Patterns and recipes

### Read a class body without loading the whole file

1. Call `find_symbol` with the class name to get its symbol path.
2. Call `get_symbol_body` with that symbol path.
3. Inspect methods by calling `get_symbol_body` on individual method symbol paths if you only need specific ones.

Do not call `Read` on the file just to see the class — `get_symbol_body` returns exactly the tokens you need.

### Find all callers of a function

1. Call `find_symbol` with the function name to confirm the symbol path.
2. Call `find_references` with that symbol path.
3. For each reference site returned, call `get_symbol_body` on the enclosing method symbol path if you need the surrounding context.

This is far more reliable than grepping for the function name as a string, which misses aliased imports and dynamic calls tracked in the symbol graph.

### Navigate from an interface to its implementation

1. Call `find_symbol` with the interface or abstract class name.
2. Call `find_implementations` with that symbol path.
3. For each concrete implementation returned, call `get_symbol_body` to read the override you care about.

Use this pattern when a caller holds a reference typed as an interface and you need to understand what actually runs at runtime.

## Pitfalls

- **Do not call `activate_project` manually under normal operation.** The MCP server starts with `--project-from-cwd`, which resolves the project automatically. Calling `activate_project` unnecessarily re-indexes the project and wastes time.
- **If symbol queries return "no active project"**, the auto-detection failed (e.g. the working directory is outside any indexed repo root). Recover by calling `activate_project` with the absolute path to the repository root, then retry your original query.
- **Do not mix `Read`-on-file with `get_symbol_body` for the same symbol.** Reading the whole file and then also fetching the symbol body doubles the token cost with no additional information. Pick one approach per symbol.
- **`search_symbols` is for discovery, not for authoritative lookup.** It may return multiple matches with similar names. Always confirm the exact symbol path with `find_symbol` before passing it to `get_symbol_body` or `find_references`.
- **Symbol paths are language- and project-specific.** Do not guess a symbol path — derive it from a `find_symbol` or `search_symbols` response for the current project.
