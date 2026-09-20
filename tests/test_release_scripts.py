"""Driving tests for the release helper scripts in .github/scripts/ (epic #39).

R1 prev-release-tag.sh, R2 preflight-tags.sh, R3 marketplace-payload.sh.
`gh` is replaced by a stub script placed first on PATH; `jq` must be installed.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / ".github" / "scripts"
BASH = r"C:\Program Files\Git\bin\bash.exe" if sys.platform == "win32" else "/bin/bash"

PLUGIN = "agent-serena-wrapper"
REPO = "Seretos/agent-serena-wrapper"


def run_script(name, args=(), stdin="", env=None):
    full_env = dict(os.environ)
    full_env.update(env or {})
    return subprocess.run(
        [BASH, (SCRIPTS / name).as_posix(), *args],
        input=stdin.encode("utf-8"),
        capture_output=True,
        cwd=ROOT,
        env=full_env,
        timeout=60,
    )


def text(b):
    return b.decode("utf-8", errors="replace")


# ---------------------------------------------------------------- R1

def prev(tag, tags):
    return run_script("prev-release-tag.sh", [tag], stdin="\n".join(tags) + ("\n" if tags else ""))


def v(x):
    return f"{PLUGIN}--v{x}"


def test_prev_release_tag_picks_semver_highest():
    r = prev(v("0.1.5"), [v("0.0.9"), v("0.1.0"), v("0.1.4")])
    assert r.returncode == 0, text(r.stderr)
    assert text(r.stdout).strip() == v("0.1.4")


def test_prev_release_tag_numeric_not_lexical():
    r = prev(v("10.0.1"), [v("9.0.0"), v("10.0.0")])
    assert r.returncode == 0, text(r.stderr)
    assert text(r.stdout).strip() == v("10.0.0")
    r = prev(v("11.0.0"), [v("10.0.0"), v("9.0.0")])
    assert text(r.stdout).strip() == v("10.0.0")


def test_prev_release_tag_prerelease_ordering():
    tags = [v("0.2.0-rc.10"), v("0.2.0-rc.2"), v("0.1.4")]
    r = prev(v("0.2.0"), tags)
    assert r.returncode == 0, text(r.stderr)
    assert text(r.stdout).strip() == v("0.2.0-rc.10")
    # a release beats its own prereleases
    r = prev(v("0.3.0"), tags + [v("0.2.0")])
    assert text(r.stdout).strip() == v("0.2.0")


def test_prev_release_tag_excludes_tag_being_created():
    r = prev(v("0.1.4"), [v("0.1.3"), v("0.1.4")])
    assert r.returncode == 0, text(r.stderr)
    assert text(r.stdout).strip() == v("0.1.3")


def test_prev_release_tag_ignores_src_and_foreign_tags():
    tags = [v("0.1.3"), f"src/{v('0.1.4')}", "other-plugin--v9.9.9", "v9.9.9"]
    r = prev(v("0.1.5"), tags)
    assert r.returncode == 0, text(r.stderr)
    assert text(r.stdout).strip() == v("0.1.3")


def test_prev_release_tag_stale_src_marker_of_burned_version_ignored():
    r = prev(v("0.1.5"), [v("0.1.4"), f"src/{v('0.1.6')}"])
    assert text(r.stdout).strip() == v("0.1.4")


@pytest.mark.parametrize("tags", [[], ["other-plugin--v1.0.0", f"src/{v('0.1.4')}"], [v("0.1.5")]])
def test_prev_release_tag_first_release_prints_nothing_exit_0(tags):
    r = prev(v("0.1.5"), tags)
    assert r.returncode == 0, text(r.stderr)
    assert text(r.stdout).strip() == ""


@pytest.mark.parametrize("bad", [v("01.2.3"), v("1.2"), "1.2.3"])
def test_prev_release_tag_malformed_new_tag_exits_2(bad):
    r = prev(bad, [v("0.1.4")])
    assert r.returncode == 2


# ---------------------------------------------------------------- gh stub

GH_STUB = r"""#!/usr/bin/env bash
# Stub gh: logs every call; `gh api repos/R/git/refs/tags/<ref>` succeeds iff <ref>
# is listed in $GH_STUB_EXISTING (newline separated).
echo "$*" >> "$GH_STUB_LOG"
if [ -n "${GH_STUB_FAIL:-}" ]; then
  echo "gh: simulated failure (HTTP 500)" >&2
  exit 1
fi
if [ "$1" = "api" ]; then
  ref="${2#repos/*/git/refs/tags/}"
  if printf '%s\n' "$GH_STUB_EXISTING" | grep -Fxq -- "$ref"; then
    echo '{"ref":"refs/tags/'"$ref"'"}'
    exit 0
  fi
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
fi
if [ "$1" = "release" ] && [ "$2" = "view" ]; then
  cat "$GH_STUB_BODY_FILE"
  printf '\n'
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 99
"""


@pytest.fixture
def gh_env(tmp_path):
    if shutil.which("jq") is None:
        pytest.fail("jq must be installed on PATH")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    stub = bindir / "gh"
    stub.write_bytes(GH_STUB.encode("utf-8"))
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "gh.log"
    log.write_text("")
    body = tmp_path / "body.txt"
    body.write_bytes(b"")
    return {
        "PATH": str(bindir) + os.pathsep + os.environ["PATH"],
        "GH_STUB_LOG": str(log),
        "GH_STUB_BODY_FILE": str(body),
        "GH_STUB_EXISTING": "",
        "_log": log,
        "_body": body,
    }


def env_of(gh_env, **extra):
    e = {k: val for k, val in gh_env.items() if not k.startswith("_")}
    e.update(extra)
    return e


# ---------------------------------------------------------------- R2

TAG = v("0.1.5")
PREV = v("0.1.4")


def preflight(gh_env, existing, prev_tag=PREV, **extra):
    return run_script(
        "preflight-tags.sh",
        env=env_of(
            gh_env,
            REPO=REPO,
            TAG=TAG,
            PREV_TAG=prev_tag,
            GH_STUB_EXISTING="\n".join(existing),
            **extra,
        ),
    )


def assert_read_only(gh_env):
    for line in gh_env["_log"].read_text().splitlines():
        assert "-X" not in line and "--method" not in line and "-f " not in line, line
        assert line.startswith("api repos/"), line


def test_preflight_passes_when_prev_marker_exists(gh_env):
    r = preflight(gh_env, [f"src/{PREV}"])
    assert r.returncode == 0, text(r.stderr) + text(r.stdout)
    assert_read_only(gh_env)


def test_preflight_fails_when_release_tag_exists(gh_env):
    r = preflight(gh_env, [f"src/{PREV}", TAG])
    assert r.returncode == 1
    assert TAG in text(r.stdout) + text(r.stderr)


def test_preflight_fails_when_src_marker_exists(gh_env):
    r = preflight(gh_env, [f"src/{PREV}", f"src/{TAG}"])
    assert r.returncode == 1
    assert f"src/{TAG}" in text(r.stdout) + text(r.stderr)
    assert_read_only(gh_env)


def test_preflight_missing_prev_marker_prints_bootstrap_commands(gh_env):
    r = preflight(gh_env, [])
    assert r.returncode == 1
    out = text(r.stdout) + text(r.stderr)
    assert f"git tag src/{PREV} " in out
    assert f"git push origin src/{PREV}" in out
    assert_read_only(gh_env)


def test_preflight_first_release_empty_prev_tag_passes(gh_env):
    r = preflight(gh_env, [], prev_tag="")
    assert r.returncode == 0, text(r.stderr) + text(r.stdout)


def test_preflight_gh_failure_is_not_read_as_absent(gh_env):
    r = preflight(gh_env, [f"src/{PREV}"], GH_STUB_FAIL="1")
    assert r.returncode != 0


# ---------------------------------------------------------------- R3

NINE = {
    "name", "description", "repo", "category", "version", "ref", "icon",
    "description_url", "tags",
}

HOSTILE = (
    "#123 @user fixed `thing`\n"
    'quote " backslash \\ $(whoami) ${X} \\n literal\n'
    "\n"
    "second para \u00e4\u00f6\u00fc \u2713"
)


def payload(gh_env, body, description='Serena "wrapper" skill', **extra):
    gh_env["_body"].write_bytes(body.encode("utf-8"))
    return run_script(
        "marketplace-payload.sh",
        env=env_of(
            gh_env,
            REPO=REPO,
            TAG=TAG,
            NAME=PLUGIN,
            DESCRIPTION=description,
            VERSION="0.1.5",
            **extra,
        ),
    )


def test_marketplace_payload_changelog_byte_exact_and_nine_fields(gh_env):
    r = payload(gh_env, HOSTILE)
    assert r.returncode == 0, text(r.stderr)
    doc = json.loads(r.stdout.decode("utf-8"))
    assert doc["event_type"] == "plugin-release"
    cp = doc["client_payload"]
    assert cp["changelog"] == HOSTILE
    assert set(cp) == NINE | {"changelog"}
    assert cp["name"] == PLUGIN
    assert cp["repo"] == REPO
    assert cp["category"] == "skill"
    assert cp["version"] == "0.1.5"
    assert cp["ref"] == TAG
    assert cp["icon"] == f"https://raw.githubusercontent.com/{REPO}/{TAG}/assets/icon.png"
    assert cp["description_url"] == f"https://raw.githubusercontent.com/{REPO}/{TAG}/description.md"


def test_marketplace_payload_description_with_quote_and_tags_array(gh_env):
    r = payload(gh_env, "notes")
    assert r.returncode == 0, text(r.stderr)
    cp = json.loads(r.stdout.decode("utf-8"))["client_payload"]
    assert cp["description"] == 'Serena "wrapper" skill'
    assert cp["tags"] == ["coding"]


def test_marketplace_payload_empty_body_omits_changelog(gh_env):
    r = payload(gh_env, "")
    assert r.returncode == 0, text(r.stderr)
    cp = json.loads(r.stdout.decode("utf-8"))["client_payload"]
    assert "changelog" not in cp
    assert set(cp) == NINE


def test_marketplace_payload_gh_failure_aborts(gh_env):
    r = payload(gh_env, "notes", GH_STUB_FAIL="1")
    assert r.returncode != 0
