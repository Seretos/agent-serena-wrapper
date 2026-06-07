#!/usr/bin/env node
/**
 * PreToolUse hook — Serena MCP reminder.
 *
 * Fires on Read, Glob, and Grep. When the working directory is inside a
 * Serena-active repository (detected by walking up for .serena/project.yml),
 * injects an additionalContext reminder encouraging use of Serena MCP tools
 * over raw file exploration. Otherwise exits silently (pass-through).
 *
 * If .serena/project.yml has an empty `languages:` list, the hook attempts
 * to detect languages from project source files and patches the config so
 * symbol tools become active without manual editing. If no language can be
 * detected a targeted warning is injected into additionalContext instead of
 * failing silently.
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

const NO_LANGUAGE_WARNING =
  " Warning: .serena/project.yml has no languages configured — " +
  "symbol tools are inactive until at least one language is added " +
  "under 'languages:' in .serena/project.yml.";

/** Extension → Serena language key mapping. */
const EXT_TO_LANGUAGE = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "cpp",
  ".h": "cpp",
  ".kt": "kotlin",
  ".swift": "swift",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
};

/** Source languages sort before config/doc languages so the first entry is a real LSP. */
const SOURCE_LANGUAGES = new Set([
  "typescript",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "ruby",
  "php",
  "cpp",
  "kotlin",
  "swift",
]);

/**
 * Walk up from `startDir` looking for `.serena/project.yml`.
 * Returns the resolved path to `project.yml` if found, or `null` if the
 * filesystem root is reached without finding one.
 */
function isSerenaActive(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, MARKER);
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return candidate;
    } catch {
      // not here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // reached filesystem root
      return null;
    }
    dir = parent;
  }
}

/**
 * Reads the `languages:` block from a project.yml file via regex.
 * Returns an array of language strings already configured, or `[]` if the
 * block is present but empty, absent, or the file cannot be read.
 *
 * Handles `languages:` both mid-file (followed by \n) and at EOF (no trailing
 * newline).
 */
function readLanguages(projectYmlPath) {
  let text;
  try {
    text = fs.readFileSync(projectYmlPath, "utf8");
  } catch {
    return [];
  }
  // Match `languages:` optionally followed by a newline and zero or more
  // `- entry\n` lines. The `(?:\n|$)` allows the key to sit at EOF.
  const m = text.match(/^languages:(?:\n((?:- .*\n)*))?/m);
  if (!m) {
    return [];
  }
  const block = m[1] || "";
  const entries = block
    .split("\n")
    .map((l) => l.replace(/^- /, "").trim())
    .filter(Boolean);
  return entries;
}

/**
 * Scans the repo root and every immediate subdirectory (depth 1) for files
 * whose extensions map to Serena language keys. Skips `.git`, `node_modules`,
 * and `.serena`. Caps total entries examined at 200.
 *
 * Returns a deduplicated, priority-ordered array: source languages first,
 * then config/doc languages.
 */
function detectLanguages(repoRoot) {
  const SKIP_DIRS = new Set([".git", "node_modules", ".serena"]);
  const detected = new Set();
  let budget = 200;

  /**
   * Examine a pre-read entries array for a single directory.
   * Returns false when budget exhausted.
   */
  function scanEntries(entries) {
    for (const entry of entries) {
      if (budget <= 0) return false;
      budget--;
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = EXT_TO_LANGUAGE[ext];
        if (lang) {
          detected.add(lang);
        }
      }
    }
    return true; // budget not yet exhausted
  }

  // Read root entries once; reuse for both file scanning and subdir iteration.
  let rootEntries;
  try {
    rootEntries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return sortLanguages(detected);
  }

  // Scan root files first.
  if (!scanEntries(rootEntries)) {
    return sortLanguages(detected);
  }

  // Scan immediate subdirectories (depth 1 only).
  for (const entry of rootEntries) {
    if (budget <= 0) break;
    if (
      entry.isDirectory() &&
      !SKIP_DIRS.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      let subEntries;
      try {
        subEntries = fs.readdirSync(path.join(repoRoot, entry.name), {
          withFileTypes: true,
        });
      } catch {
        continue; // unreadable — skip silently
      }
      if (!scanEntries(subEntries)) {
        break;
      }
    }
  }

  return sortLanguages(detected);
}

/** Sort detected languages: source languages first, then config/doc languages. */
function sortLanguages(languageSet) {
  const source = [];
  const config = [];
  for (const lang of languageSet) {
    if (SOURCE_LANGUAGES.has(lang)) {
      source.push(lang);
    } else {
      config.push(lang);
    }
  }
  return [...source, ...config];
}

/**
 * Rewrites the `languages:` block in project.yml using string replacement,
 * preserving all comments and other fields. Uses write-to-temp-then-rename
 * for atomicity. Swallows any write error — the hook must never block a call.
 *
 * Handles `languages:` both mid-file (followed by \n) and at EOF (no trailing
 * newline), as well as an already-populated list.
 */
function patchLanguages(projectYmlPath, languages) {
  let text;
  try {
    text = fs.readFileSync(projectYmlPath, "utf8");
  } catch {
    return;
  }

  const newBlock =
    "languages:\n" + languages.map((l) => `- ${l}\n`).join("");

  // Replace the existing languages block including any current entries.
  // The pattern matches:
  //   - `languages:` optionally followed by a newline and zero or more entry lines, OR
  //   - `languages:` at EOF (no newline).
  const patched = text.replace(
    /^languages:(?:\n(?:- .*\n)*)?/m,
    newBlock
  );

  if (patched === text) {
    // Nothing changed (block not found or no-op) — skip write.
    return;
  }

  const dir = path.dirname(projectYmlPath);
  const tmp = path.join(dir, `.project.yml.tmp.${process.pid}`);
  try {
    fs.writeFileSync(tmp, patched, "utf8");
    fs.renameSync(tmp, projectYmlPath);
  } catch {
    // Silently swallow — never block the tool call.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
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
  const projectYmlPath = isSerenaActive(cwd);
  if (projectYmlPath === null) {
    process.exit(0);
  }

  // Determine repo root (parent of .serena/).
  const repoRoot = path.dirname(path.dirname(projectYmlPath));

  // Decide what additionalContext to emit.
  let additionalContext = REMINDER;

  const existingLanguages = readLanguages(projectYmlPath);
  if (existingLanguages.length === 0) {
    // Languages not yet configured — attempt auto-detection.
    const detected = detectLanguages(repoRoot);
    if (detected.length > 0) {
      patchLanguages(projectYmlPath, detected);
      // REMINDER is sufficient — languages are now configured.
    } else {
      // Nothing detectable — surface a targeted warning.
      additionalContext = REMINDER + NO_LANGUAGE_WARNING;
    }
  }
  // If existingLanguages.length > 0 — fast path: emit normal REMINDER only.

  // Emit the PreToolUse hook output — non-blocking allow + reminder context.
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext,
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
