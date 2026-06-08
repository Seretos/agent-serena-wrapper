#!/usr/bin/env node
/**
 * Tests for serena-reminder-hook.mjs
 *
 * Plain Node.js — no test framework, no external dependencies.
 * Uses fs.mkdtempSync for isolated temp directories per test.
 * Exit code 0 = all pass, non-zero = at least one failure.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readLanguages, patchLanguages } from "./serena-reminder-hook.mjs";

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory containing a .serena/project.yml with the given
 * content. Returns the absolute path to project.yml.
 */
function makeTempProject(ymlContent) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "serena-hook-test-"));
  const serenaDir = path.join(tmpDir, ".serena");
  fs.mkdirSync(serenaDir);
  const ymlPath = path.join(serenaDir, "project.yml");
  fs.writeFileSync(ymlPath, ymlContent, "utf8");
  return ymlPath;
}

/**
 * Read raw content of a project.yml path.
 */
function readRaw(ymlPath) {
  return fs.readFileSync(ymlPath, "utf8");
}

// ---------------------------------------------------------------------------
// Regression test: the exact corrupted block from the ticket
// ---------------------------------------------------------------------------

test("regression: corrupted block (blank-line-separated orphan) — readLanguages returns all entries including duplicate", () => {
  const ymlPath = makeTempProject(
    `project_name: "test"\n` +
    `languages:\n` +
    `- typescript\n` +
    `- markdown\n` +
    `- json\n` +
    `\n` +
    `- typescript\n` +
    `\n` +
    `# the encoding\n` +
    `encoding: "utf-8"\n`
  );

  const langs = readLanguages(ymlPath);
  // The new regex must capture all 4 entries (including the orphaned duplicate).
  assertEqual(langs, ["typescript", "markdown", "json", "typescript"],
    "readLanguages with corrupted block");
});

test("regression: corrupted block — after patchLanguages with deduped list, file is clean", () => {
  const ymlPath = makeTempProject(
    `project_name: "test"\n` +
    `languages:\n` +
    `- typescript\n` +
    `- markdown\n` +
    `- json\n` +
    `\n` +
    `- typescript\n` +
    `\n` +
    `# the encoding\n` +
    `encoding: "utf-8"\n`
  );

  // Simulate what main() does: read, dedup, patch.
  const raw = readLanguages(ymlPath);
  const deduped = [...new Set(raw)];
  patchLanguages(ymlPath, deduped);

  const content = readRaw(ymlPath);

  // The clean block must be present.
  assert(content.includes("languages:\n- typescript\n- markdown\n- json\n"),
    "clean block present after patch");

  // No orphaned entries must remain.
  const afterBlock = content.split("languages:\n")[1];
  const orphanMatch = afterBlock.match(/^- typescript\n.*^- typescript\n/ms);
  assert(!orphanMatch, "no orphaned duplicate entry after patch");

  // The comment after the block must still be present.
  assert(content.includes("# the encoding"), "comment after block preserved");
  assert(content.includes('encoding: "utf-8"'), "encoding key preserved");

  // readLanguages on the cleaned file must return exactly 3 unique entries.
  const cleaned = readLanguages(ymlPath);
  assertEqual(cleaned, ["typescript", "markdown", "json"],
    "readLanguages after patch returns clean 3-entry list");
});

// ---------------------------------------------------------------------------
// readLanguages edge cases
// ---------------------------------------------------------------------------

test("readLanguages: languages: at EOF with no trailing newline returns []", () => {
  const ymlPath = makeTempProject(`project_name: "test"\nlanguages:`);
  assertEqual(readLanguages(ymlPath), [], "EOF no trailing newline");
});

test("readLanguages: languages: followed immediately by empty value (colon+newline then next key) returns []", () => {
  const ymlPath = makeTempProject(
    `project_name: "test"\n` +
    `languages:\n` +
    `encoding: "utf-8"\n`
  );
  assertEqual(readLanguages(ymlPath), [], "empty list before next key");
});

test("readLanguages: languages: with blank-only line then next key returns []", () => {
  const ymlPath = makeTempProject(
    `project_name: "test"\n` +
    `languages:\n` +
    `\n` +
    `encoding: "utf-8"\n`
  );
  // A blank line followed by a real key — no `- entry` lines present.
  assertEqual(readLanguages(ymlPath), [], "blank line then next key → empty");
});

test("readLanguages: valid 3-entry list returns all 3", () => {
  const ymlPath = makeTempProject(
    `languages:\n` +
    `- typescript\n` +
    `- markdown\n` +
    `- json\n` +
    `\n` +
    `encoding: "utf-8"\n`
  );
  assertEqual(readLanguages(ymlPath), ["typescript", "markdown", "json"],
    "valid 3-entry list");
});

test("readLanguages: interleaved blank lines — returns all entries, no blanks", () => {
  const ymlPath = makeTempProject(
    `languages:\n` +
    `- typescript\n` +
    `\n` +
    `- python\n` +
    `\n` +
    `encoding: "utf-8"\n`
  );
  assertEqual(readLanguages(ymlPath), ["typescript", "python"],
    "interleaved blanks filtered out");
});

test("readLanguages: file unreadable returns []", () => {
  assertEqual(readLanguages("/nonexistent/path/project.yml"), [],
    "unreadable file");
});

// ---------------------------------------------------------------------------
// patchLanguages edge cases
// ---------------------------------------------------------------------------

test("patchLanguages: languages: at EOF with no trailing newline — writes valid block", () => {
  const ymlPath = makeTempProject(`project_name: "test"\nlanguages:`);
  patchLanguages(ymlPath, ["typescript"]);
  const content = readRaw(ymlPath);
  assert(content.includes("languages:\n- typescript\n"), "block written at EOF");
});

test("patchLanguages: already-valid 3-entry list — produces equivalent valid output", () => {
  const original =
    `languages:\n` +
    `- typescript\n` +
    `- markdown\n` +
    `- json\n` +
    `\n` +
    `# the encoding\n` +
    `encoding: "utf-8"\n`;
  const ymlPath = makeTempProject(original);
  patchLanguages(ymlPath, ["typescript", "markdown", "json"]);
  const content = readRaw(ymlPath);
  assert(content.includes("languages:\n- typescript\n- markdown\n- json\n"),
    "valid block preserved");
  assert(content.includes("# the encoding"), "trailing comment preserved");
  assert(content.includes('encoding: "utf-8"'), "encoding key preserved");
});

test("patchLanguages: replacement does not consume the next YAML key", () => {
  const ymlPath = makeTempProject(
    `languages:\n` +
    `- typescript\n` +
    `encoding: "utf-8"\n`
  );
  patchLanguages(ymlPath, ["python"]);
  const content = readRaw(ymlPath);
  assert(content.includes("languages:\n- python\n"), "new entry written");
  assert(content.includes('encoding: "utf-8"'), "next key not consumed");
  assert(!content.includes("- typescript"), "old entry removed");
});

test("patchLanguages: duplicate entries — dedup normalises file", () => {
  const ymlPath = makeTempProject(
    `languages:\n` +
    `- typescript\n` +
    `- markdown\n` +
    `- json\n` +
    `\n` +
    `- typescript\n` +
    `\n` +
    `encoding: "utf-8"\n`
  );
  const raw = readLanguages(ymlPath);
  const deduped = [...new Set(raw)];
  patchLanguages(ymlPath, deduped);
  const after = readLanguages(ymlPath);
  assertEqual(after, ["typescript", "markdown", "json"],
    "deduped entries after patch");
  // Confirm no blank lines remain inside the languages block.
  const content = readRaw(ymlPath);
  const blockMatch = content.match(/^languages:[ \t]*\n((?:.*\n)*?)(?:^[a-z#])/m);
  if (blockMatch) {
    assert(!blockMatch[1].includes("\n\n"), "no blank lines in cleaned block");
  }
});

test("patchLanguages: interleaved blank lines, no duplicates — clean output, no blanks inside block", () => {
  const ymlPath = makeTempProject(
    `languages:\n` +
    `- typescript\n` +
    `\n` +
    `- python\n` +
    `\n` +
    `encoding: "utf-8"\n`
  );
  // patchLanguages with the same unique entries should still clean the blanks.
  patchLanguages(ymlPath, ["typescript", "python"]);
  const content = readRaw(ymlPath);
  assert(content.includes("languages:\n- typescript\n- python\n"),
    "clean block without interleaved blanks");
  assert(content.includes('encoding: "utf-8"'), "next key preserved");
});

// ---------------------------------------------------------------------------
// CRLF line-ending tests
// ---------------------------------------------------------------------------

test("CRLF: readLanguages on mixed LF/CRLF file returns 6 entries (3 duplicates)", () => {
  // Mirrors the exact corrupted pattern from the real .serena/project.yml:
  // - LF-terminated triplet
  // - CRLF blank separator line
  // - CRLF-terminated duplicate triplet
  const ymlContent =
    "project_name: \"test\"\r\n" +
    "languages:\n" +
    "- typescript\n" +
    "- markdown\n" +
    "- json\n" +
    "\r\n" +
    "- typescript\r\n" +
    "- markdown\r\n" +
    "- json\r\n" +
    "\r\n" +
    "encoding: \"utf-8\"\r\n";

  const ymlPath = makeTempProject(ymlContent);
  const langs = readLanguages(ymlPath);
  // Must detect all 6 entries (3 + 3 duplicate), not just the first 3.
  assertEqual(langs, ["typescript", "markdown", "json", "typescript", "markdown", "json"],
    "readLanguages with CRLF mixed file returns 6 entries");
});

test("CRLF: patchLanguages on mixed LF/CRLF file produces clean LF-only languages block", () => {
  // Same mixed pattern as above.
  const ymlContent =
    "project_name: \"test\"\r\n" +
    "languages:\n" +
    "- typescript\n" +
    "- markdown\n" +
    "- json\n" +
    "\r\n" +
    "- typescript\r\n" +
    "- markdown\r\n" +
    "- json\r\n" +
    "\r\n" +
    "encoding: \"utf-8\"\r\n";

  const ymlPath = makeTempProject(ymlContent);

  // Simulate what main() does: read → dedup → patch.
  const raw = readLanguages(ymlPath);
  const deduped = [...new Set(raw)];
  patchLanguages(ymlPath, deduped);

  const content = readRaw(ymlPath);

  // Exactly one clean triplet must be present.
  assert(content.includes("languages:\n- typescript\n- markdown\n- json\n"),
    "clean LF-only block present after patch");

  // No \r must remain inside the languages block section.
  const afterLanguagesKey = content.split("languages:\n")[1];
  // Everything up to the next non-entry/non-blank line.
  const blockLines = [];
  for (const line of afterLanguagesKey.split("\n")) {
    if (/^- /.test(line) || /^[ \t\r]*$/.test(line)) {
      blockLines.push(line);
    } else {
      break;
    }
  }
  const blockText = blockLines.join("\n");
  assert(!blockText.includes("\r"),
    "no \\r in languages block after patch");

  // No CRLF orphan duplicates remain.
  const dupeMatch = content.match(/- typescript[\s\S]*?- typescript/);
  assert(!dupeMatch, "no duplicate typescript entry after patch");

  // Section after block is intact.
  assert(content.includes("encoding"), "encoding key still present after patch");

  // readLanguages on the cleaned file returns exactly 3 unique entries.
  const cleaned = readLanguages(ymlPath);
  assertEqual(cleaned, ["typescript", "markdown", "json"],
    "readLanguages after patch returns clean 3-entry list");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
