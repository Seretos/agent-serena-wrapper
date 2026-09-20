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

test("codex manifest: args[0] is ${PLUGIN_ROOT}/scripts/serena-boot-wrapper.mjs and node loads it cleanly", () => {
  const server = readManifest(".codex-plugin").mcpServers.serena;
  assertEqual(server.command, "node", "command");
  assertEqual(
    server.args[0],
    "${PLUGIN_ROOT}/scripts/serena-boot-wrapper.mjs",
    "args[0]"
  );

  const args = server.args.map((a) => substitute(a, { PLUGIN_ROOT: repoRoot }));
  for (const a of args) {
    assert(!a.includes("${"), `unsubstituted placeholder left in arg: ${a}`);
  }
  assertEqual(path.basename(args[0]), "serena-boot-wrapper.mjs", "args[0] basename");
  assert(fs.existsSync(args[0]), `args[0] does not exist on disk: ${args[0]}`);

  // Empty PATH: uvx cannot resolve, so nothing is downloaded/started.
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-manifest-test-"));
  const env = { ...process.env, PATH: emptyDir, Path: emptyDir };
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 30000 });
  const stderr = result.stderr ?? "";
  assert(
    !/Cannot find module|MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/.test(stderr),
    `node failed to load the launch script: ${stderr.split("\n")[0]}`
  );
  // MCP stdio: stdout carries the protocol; the wrapper must not pollute it.
  assertEqual(result.stdout ?? "", "", "stdout of the spawned wrapper");
});

// ---------------------------------------------------------------------------
// R3 — spawn failure is reported, not silent
// ---------------------------------------------------------------------------

function captureRun(argv, spawnResult) {
  const origExit = process.exit;
  const origErr = process.stderr.write;
  const origOut = process.stdout.write;
  let exitCode = null;
  let stderr = "";
  let stdout = "";
  process.exit = (code) => { exitCode = code; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  try {
    run(argv, { spawnSync: () => spawnResult });
  } finally {
    process.exit = origExit;
    process.stderr.write = origErr;
    process.stdout.write = origOut;
  }
  return { exitCode, stderr, stdout };
}

test("boot-wrapper: spawn error is reported on stderr (with the error text), stdout empty, exit code 1", () => {
  const { exitCode, stderr, stdout } = captureRun(["--project-from-cwd"], {
    error: new Error("spawn uvx ENOENT-xyz"),
    status: null,
  });
  assert(stderr.includes("uvx"), `stderr does not mention uvx: ${JSON.stringify(stderr)}`);
  assert(
    stderr.includes("ENOENT-xyz"),
    `stderr does not include the spawn error text: ${JSON.stringify(stderr)}`
  );
  assertEqual(stdout, "", "stdout");
  assertEqual(exitCode, 1, "exit code");
});

test("boot-wrapper: successful spawn writes nothing to stderr/stdout and exits 0", () => {
  const { exitCode, stderr, stdout } = captureRun(["--project-from-cwd"], { status: 0 });
  assertEqual(stderr, "", "stderr");
  assertEqual(stdout, "", "stdout");
  assertEqual(exitCode, 0, "exit code");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
