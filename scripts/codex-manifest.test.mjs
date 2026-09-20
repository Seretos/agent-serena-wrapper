#!/usr/bin/env node
/**
 * codex-manifest.test.mjs — regression guard for ticket #38.
 *
 * Resolves and executes the Codex manifest's MCP launch argv using only the
 * variables Codex provides (PLUGIN_ROOT), and checks the boot wrapper reports
 * a failed spawn instead of exiting silently.
 *
 * Run: node scripts/codex-manifest.test.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run } from "./serena-boot-wrapper.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, dir, "plugin.json"), "utf8"));
}

/** Substitute ${NAME} using only the given variable map (others stay as-is). */
function substitute(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (m, name) => (name in vars ? vars[name] : m));
}

// ---------------------------------------------------------------------------
// R1 — Codex argv resolves with only Codex's variables
// ---------------------------------------------------------------------------

test("codex manifest: argv resolves via PLUGIN_ROOT alone and node loads the script", () => {
  const server = readManifest(".codex-plugin").mcpServers.serena;
  const args = server.args.map((a) => substitute(a, { PLUGIN_ROOT: repoRoot }));

  for (const a of args) {
    assert(!a.includes("${"), `unsubstituted placeholder left in arg: ${a}`);
  }
  assert(fs.existsSync(args[0]), `args[0] does not exist on disk: ${args[0]}`);

  // Empty PATH: uvx cannot resolve, so nothing is downloaded/started.
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-manifest-test-"));
  const env = { ...process.env, PATH: emptyDir, Path: emptyDir };
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 30000 });
  const stderr = result.stderr ?? "";
  assert(
    !/Cannot find module|MODULE_NOT_FOUND/.test(stderr),
    `node failed to load the launch script: ${stderr.split("\n")[0]}`
  );
});

test("codex manifest: command is exactly node (no placeholder in command)", () => {
  const server = readManifest(".codex-plugin").mcpServers.serena;
  assertEqual(server.command, "node", "command");
});

test("codex manifest: no CLAUDE_-prefixed variable anywhere", () => {
  const raw = fs.readFileSync(path.join(repoRoot, ".codex-plugin", "plugin.json"), "utf8");
  assert(!/\$\{CLAUDE_/.test(raw), "Codex manifest references a CLAUDE_ variable");
});

test("claude manifest: still uses CLAUDE_ variables and args[0] resolves", () => {
  const raw = fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8");
  assert(raw.includes("${CLAUDE_PLUGIN_ROOT}"), "missing ${CLAUDE_PLUGIN_ROOT}");
  assert(raw.includes("${CLAUDE_PROJECT_DIR}"), "missing ${CLAUDE_PROJECT_DIR}");
  const server = readManifest(".claude-plugin").mcpServers.serena;
  const first = substitute(server.args[0], { CLAUDE_PLUGIN_ROOT: repoRoot });
  assert(fs.existsSync(first), `Claude args[0] does not exist: ${first}`);
});

// ---------------------------------------------------------------------------
// R3 — spawn failure is reported, not silent
// ---------------------------------------------------------------------------

function captureRun(argv, spawnResult) {
  const origExit = process.exit;
  const origWrite = process.stderr.write;
  let exitCode = null;
  let stderr = "";
  process.exit = (code) => { exitCode = code; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    run(argv, { spawnSync: () => spawnResult });
  } finally {
    process.exit = origExit;
    process.stderr.write = origWrite;
  }
  return { exitCode, stderr };
}

test("boot-wrapper: spawn error is reported on stderr naming uvx, exit code 1", () => {
  const { exitCode, stderr } = captureRun(["--project-from-cwd"], {
    error: new Error("spawn uvx ENOENT"),
    status: null,
  });
  assert(stderr.includes("uvx"), `stderr does not mention uvx: ${JSON.stringify(stderr)}`);
  assertEqual(exitCode, 1, "exit code");
});

test("boot-wrapper: successful spawn writes nothing to stderr and exits 0", () => {
  const { exitCode, stderr } = captureRun(["--project-from-cwd"], { status: 0 });
  assertEqual(stderr, "", "stderr");
  assertEqual(exitCode, 0, "exit code");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
