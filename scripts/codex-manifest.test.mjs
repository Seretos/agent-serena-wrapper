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
  assert(fs.existsSync(args[0]), `args[0] does not exist on disk: ${args[0]}`);

  // Launch the manifest's declared command itself (not process.execPath), so a
  // placeholder or unresolvable command fails the launch. PATH holds only
  // node's own directory (minus any uvx), so nothing is downloaded/started.
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-manifest-test-"));
  const nodeName = path.basename(process.execPath);
  fs.copyFileSync(process.execPath, path.join(nodeDir, nodeName));
  const env = { ...process.env, PATH: nodeDir, Path: nodeDir };
  const result = spawnSync(server.command, args, { env, encoding: "utf8", timeout: 30000 });
  assert(!result.error, `could not launch declared command ${JSON.stringify(server.command)}: ${result.error?.message}`);
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

// ---------------------------------------------------------------------------
// Edge coverage — manifests and release staging
// ---------------------------------------------------------------------------

test("codex manifest: no CLAUDE_-prefixed variable anywhere", () => {
  const raw = fs.readFileSync(path.join(repoRoot, ".codex-plugin", "plugin.json"), "utf8");
  assert(!/\$\{CLAUDE_/.test(raw), "Codex manifest references a CLAUDE_ variable");
});

test("claude manifest: still uses CLAUDE_PLUGIN_ROOT / CLAUDE_PROJECT_DIR and args[0] resolves", () => {
  const server = readManifest(".claude-plugin").mcpServers.serena;
  assertEqual(server.args[0], "${CLAUDE_PLUGIN_ROOT}/scripts/serena-boot-wrapper.mjs", "args[0]");
  assert(server.args.includes("${CLAUDE_PROJECT_DIR}"), "CLAUDE_PROJECT_DIR missing");
  const first = substitute(server.args[0], { CLAUDE_PLUGIN_ROOT: repoRoot });
  assert(fs.existsSync(first), `args[0] does not exist: ${first}`);
});

test("release.yml stages the Codex manifest and every plugin-root dir either manifest references", () => {
  const release = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
  const refs = new Set();
  for (const dir of [".claude-plugin", ".codex-plugin"]) {
    for (const a of readManifest(dir).mcpServers.serena.args) {
      const m = /^\$\{(?:CLAUDE_)?PLUGIN_ROOT\}\/([^/]+)\//.exec(a);
      if (m) refs.add(m[1]);
    }
  }
  assert(refs.size > 0, "no plugin-root-relative references found");
  for (const d of refs) {
    assert(new RegExp(`cp -a ${d}(/\\.)? `).test(release), `release.yml stage step does not copy ${d}/`);
  }
  assert(release.includes("cp .codex-plugin/plugin.json"), "release.yml does not stage the Codex manifest");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
