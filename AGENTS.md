# agent-serena-wrapper

Skill plugin that bundles an inline Serena MCP server (launched headless via `uvx`) alongside `skills/serena-wrapper/SKILL.md`. The MCP server is declared directly in the `mcpServers` block of both `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` — the host agent starts it automatically. Claude Code loads the skill when its `description` matches the user's intent.

## Tool priority

Skills and MCP tools take priority over raw file tools — and this **explicitly overrides** the generic harness default that says "prefer the dedicated file/search tools (Glob/Grep/Read)". When a skill or MCP tool covers the task, reach for it first; fall back to raw Glob/Grep/Read only when none applies.

Concretely: any *"where is X defined / what does the code support / which Y exist / how does X work / find the callers of X"* question is a **code-understanding task → use the matching skill first** (e.g. the `serena-wrapper` symbol-aware tools), never raw Glob/Grep/Read.

## Contracts an agent won't infer from the tree

- **Release is orphan-branch + marketplace dispatch.** `release.yml` (manual: Actions → release → `version=X.Y.Z`) stamps the version, then force-pushes an orphan `release` branch holding only install-ready files and POSTs a dispatch (`category: skill`) to `Seretos/agent-marketplace`. `main` and `release` share no history. Clients install at the tag `agent-serena-wrapper--vX.Y.Z`.
- **Required secret:** `MARKETPLACE_DISPATCH_TOKEN` — fine-grained PAT, `Contents: RW` + `Pull requests: RW` on `Seretos/agent-marketplace` only.
- **`assets/icon.png` is a release artifact, not just a repo file.** The dispatch payload sends a `raw.githubusercontent.com/${repo}/${TAG}/assets/icon.png` URL to the marketplace, so the file must live on the orphan `release` branch at the tagged commit — `release.yml`'s stage step copies `assets/` into the staging tree for exactly that reason. Ship `assets/icon.png` from day one or the marketplace listing has no image.
- **`description.md` is a release artifact too.** It is the richer, user-facing marketplace description (key features for the install decision) — distinct from the one-line `description` in the manifests. `release.yml` stages it onto the orphan `release` branch and the dispatch payload carries a `description_url` (`raw.githubusercontent.com/${repo}/${TAG}/description.md`). The marketplace dispatcher (`update-registry.yml`) stores the inline `description` and `description_url` as two independent registry fields (each preserved-on-omit like `icon`), so both are sent; keep `description.md` at the repo root or the raw URL won't resolve.
- **Marketplace tags are sent in the dispatch.** `release.yml`'s `client_payload` carries `"tags": ["coding"]` (JSON string list); the marketplace dispatcher reads `.tags // []`. Add/adjust tags there to change how the skill is categorized in the listing.
- **Depending on an MCP plugin:** declare it under `dependencies` in `.claude-plugin/plugin.json` (`{ "name": "agent-<mcp>", "version": ">=0.0.1 <1.0.0" }`); Claude Code installs/loads it automatically with this skill. Serena is wired directly via `mcpServers` in both manifests (not via `dependencies`), which is why `dependencies` stays `[]`.
