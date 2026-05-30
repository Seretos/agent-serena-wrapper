#!/usr/bin/env node
/**
 * PreToolUse hook — Serena MCP reminder.
 *
 * Fires on Read, Glob, and Grep. When the working directory is inside a
 * Serena-active repository (detected by walking up for .serena/project.yml),
 * injects an additionalContext reminder encouraging use of Serena MCP tools
 * over raw file exploration. Otherwise exits silently (pass-through).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MARKER = path.join(".serena", "project.yml");

const REMINDER =
  "Note: this repository has Serena MCP semantic code tools available " +
  "(find_symbol, get_symbol_body, find_references, find_implementations, " +
  "search_symbols). For understanding code structure — finding where a " +
  "symbol is defined, tracing callers/references, reading a single " +
  "class or method body, navigating inheritance, or performing a " +
  "project-wide rename — prefer Serena MCP tools over raw Read/Glob/Grep. " +
  "They are more precise, token-efficient, and already active in this session.";

/**
 * Walk up from `startDir` looking for `.serena/project.yml`.
 * Returns true if found, false if filesystem root is reached.
 */
function isSerenaActive(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, MARKER);
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return true;
    } catch {
      // not here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // reached filesystem root
      return false;
    }
    dir = parent;
  }
}

function main() {
  // Read stdin (may be empty or malformed — be fully fault-tolerant).
  let input = {};
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (raw) {
      input = JSON.parse(raw);
    }
  } catch {
    // Empty or malformed stdin — just pass through.
    process.exit(0);
  }

  // Determine working directory from payload, fall back to process.cwd().
  const cwd =
    (typeof input.cwd === "string" && input.cwd) ? input.cwd : process.cwd();

  // Scope check: only act when Serena is active in this repo.
  if (!isSerenaActive(cwd)) {
    process.exit(0);
  }

  // Emit the PreToolUse hook output — non-blocking allow + reminder context.
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: REMINDER,
    },
  };

  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}

try {
  main();
} catch (err) {
  // Never block the tool call due to an unexpected error.
  process.stderr.write(
    `serena-reminder-hook: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(0);
}
