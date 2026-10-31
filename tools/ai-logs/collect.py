#!/usr/bin/env python3
"""
AI session log collector for the RIZM take-home challenge.

AI coding tools (Claude Code, Codex CLI, Cursor, GitHub Copilot CLI, Gemini CLI)
keep a full transcript of every session on your own machine. This script copies
the transcripts of sessions that ran inside THIS repository into the hidden
.logs/ folder so they can be handed in together with your code. It never
uploads anything by itself, and it only ever reads the tools' local stores.
Standard library only, no dependencies.

Usage:
  collect.py hook <tool> [event]   called by the hook configs in this repo, JSON on stdin
  collect.py sweep         find and copy sessions from the tools' local stores
  collect.py status        show what .logs/ currently holds
  collect.py submit        sweep, mask secrets, write manifest, build the zip

Environment (mainly for tests):
  AI_LOGS_ROOT   override the repository root (default: two levels above this file)
  AI_LOGS_HOME   override the home directory the tool stores are read from
  AI_LOGS_DEBUG  print diagnostics to stderr
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

if sys.version_info < (3, 13):
    sys.exit("Python 3.13 or newer is required.")

VERSION = "1.0.0"
TOOLS = ("claude", "codex", "cursor", "copilot", "gemini")
MAX_COPY_BYTES = 200 * 1024 * 1024       # never copy a single file above this
MAX_SCAN_BYTES = 256 * 1024              # how far into a transcript we look for its cwd
MAX_SCRUB_BYTES = 50 * 1024 * 1024
DEBUG = bool(os.environ.get("AI_LOGS_DEBUG"))

# Keys from hook payloads worth keeping in events.jsonl (everything else is in the transcript).
EVENT_KEYS = (
    "prompt", "reason", "source", "status", "file_path", "edits", "attachments",
    "workspace_roots", "stop_hook_active", "loop_count", "model", "timestamp",
)
# Events after which it is worth looking at every tool's store, not only the caller's.
FULL_SWEEP_EVENTS = {"sessionstart", "sessionend", "stop", "afteragent", "agentstop"}


# ── paths ───────────────────────────────────────────────────────────────────

def root() -> Path:
    env = os.environ.get("AI_LOGS_ROOT")
    return canonical(env) if env else Path(__file__).resolve().parents[2]


def logs_dir() -> Path:
    return root() / ".logs"


def state_file() -> Path:
    return logs_dir() / ".state.json"


def home() -> Path:
    env = os.environ.get("AI_LOGS_HOME")
    return canonical(env) if env else Path.home()


def canonical(p) -> Path:
    try:
        return Path(p).expanduser().resolve()
    except Exception:
        return Path(p)


def under_root(cwd) -> bool:
    """True when cwd is the repository root or a folder inside it."""
    if not cwd or not isinstance(cwd, str):
        return False
    try:
        c = canonical(cwd)
        r = canonical(root())
        return c == r or r in c.parents
    except Exception:
        return False


def log(msg: str) -> None:
    if DEBUG:
        print(f"[ai-logs] {msg}", file=sys.stderr)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── transcript inspection ───────────────────────────────────────────────────

CWD_KEYS = ("cwd", "working_directory", "workspace_root", "project_root", "projectRoot")


def find_cwd(obj, depth: int = 0):
    """Depth-limited search for a working-directory field anywhere in a JSON value."""
    if depth > 4:
        return None
    if isinstance(obj, dict):
        for k in CWD_KEYS:
            v = obj.get(k)
            if isinstance(v, str) and v:
                return v
        for v in obj.values():
            found = find_cwd(v, depth + 1)
            if found:
                return found
    elif isinstance(obj, list):
        for v in obj[:20]:
            found = find_cwd(v, depth + 1)
            if found:
                return found
    return None


def read_head(path: Path) -> str:
    """First MAX_SCAN_BYTES of a transcript as text; transparently decompresses .zst."""
    if path.suffix == ".zst":
        try:
            from compression import zstd  # Python 3.14+
            with zstd.open(path, "rb") as fh:
                return fh.read(MAX_SCAN_BYTES).decode("utf-8", "ignore")
        except Exception:
            pass
        if shutil.which("zstd"):
            try:
                out = subprocess.run(["zstd", "-dc", str(path)], capture_output=True, timeout=20).stdout
                return out[:MAX_SCAN_BYTES].decode("utf-8", "ignore")
            except Exception:
                pass
        log(f"cannot read compressed transcript {path}")
        return ""
    try:
        with open(path, "rb") as fh:
            return fh.read(MAX_SCAN_BYTES).decode("utf-8", "ignore")
    except Exception:
        return ""


def first_cwd(path: Path):
    """The working directory a transcript was recorded in, or None."""
    head = read_head(path)
    if not head:
        return None
    parsed_any = False
    for line in head.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        parsed_any = True
        cwd = find_cwd(obj)
        if cwd:
            return cwd
    if not parsed_any:  # pretty-printed JSON (Gemini chats): parse the whole document
        try:
            if path.stat().st_size <= 5 * 1024 * 1024:
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    return find_cwd(json.load(fh))
        except Exception:
            return None
    return None


# ── state and copying ───────────────────────────────────────────────────────

def load_state() -> dict:
    try:
        with open(state_file(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def save_state(state: dict) -> None:
    try:
        logs_dir().mkdir(parents=True, exist_ok=True)
        tmp = state_file().with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, state_file())
    except Exception as exc:
        log(f"state not saved: {exc}")


def classify(srcs: dict, path: Path, matcher) -> bool:
    """Cache whether a source file/dir belongs to this repo, keyed on mtime and size."""
    key = str(path)
    try:
        st = path.stat()
    except Exception:
        return False
    entry = srcs.get(key)
    if entry and entry.get("mtime") == st.st_mtime and entry.get("size") == st.st_size:
        return bool(entry.get("match"))
    try:
        match = bool(matcher())
    except Exception as exc:
        log(f"classify {path}: {exc}")
        match = False
    srcs[key] = {"mtime": st.st_mtime, "size": st.st_size, "match": match}
    return match


def copy_file(src: Path, rel: Path) -> bool:
    """Copy src to .logs/<rel> unless the copy is already current. Returns True when copied."""
    try:
        st = src.stat()
        if st.st_size > MAX_COPY_BYTES:
            log(f"skip {src}: larger than {MAX_COPY_BYTES} bytes")
            return False
        dest = logs_dir() / rel
        if dest.exists():
            dst = dest.stat()
            if dst.st_size == st.st_size and int(dst.st_mtime) == int(st.st_mtime):
                return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        return True
    except Exception as exc:
        log(f"copy {src}: {exc}")
        return False


def files_under(d: Path):
    for f in sorted(d.rglob("*")):
        if f.is_file():
            yield f


# ── per-tool sweep adapters ─────────────────────────────────────────────────
# Each yields (source_path, path_relative_to_.logs) for every file that belongs here.

def sweep_claude(srcs: dict):
    # ~/.claude/projects/<slug>/<session>.jsonl, optional <slug>/<session>/ (tool results, subagents).
    base = home() / ".claude" / "projects"
    if not base.is_dir():
        return
    for slug in sorted(base.iterdir()):
        if not slug.is_dir():
            continue
        for f in sorted(slug.glob("*.jsonl")):
            if not classify(srcs, f, lambda f=f: under_root(first_cwd(f))):
                continue
            yield f, Path("claude") / f.name
            extra = slug / f.stem
            if extra.is_dir():
                for sub in files_under(extra):
                    yield sub, Path("claude") / f.stem / sub.relative_to(extra)


def cursor_slug(p: Path, keep_underscore: bool = True) -> str:
    """Cursor names its per-project folder after the path with every separator (and dot) as a dash:
    /Users/me/dev.code-workspace -> Users-me-dev-code-workspace."""
    s = str(p).replace("\\", "/").strip("/")
    return re.sub(r"[^A-Za-z0-9_]" if keep_underscore else r"[^A-Za-z0-9]", "-", s)


def sweep_cursor(srcs: dict):
    # ~/.cursor/projects/<slug>/agent-transcripts/<conversation>/<conversation>.jsonl
    base = home() / ".cursor" / "projects"
    if not base.is_dir():
        return
    wanted = {cursor_slug(p, k) for p in (canonical(root()), root()) for k in (True, False)}
    for d in sorted(base.iterdir()):
        if not d.is_dir() or d.name not in wanted:
            continue
        transcripts = d / "agent-transcripts"
        if transcripts.is_dir():
            for f in files_under(transcripts):
                yield f, Path("cursor") / f.relative_to(transcripts)


def sweep_codex(srcs: dict):
    # ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (or .jsonl.zst); first record carries the cwd.
    base = home() / ".codex"
    for sub in ("sessions", "archived_sessions"):
        d = base / sub
        if not d.is_dir():
            continue
        for f in sorted(d.rglob("rollout-*")):
            if f.is_file() and classify(srcs, f, lambda f=f: under_root(first_cwd(f))):
                yield f, Path("codex") / f.name


def copilot_dir_matches(d: Path) -> bool:
    wy = d / "workspace.yaml"
    if wy.is_file():
        try:
            for line in wy.read_text(encoding="utf-8", errors="ignore").splitlines():
                m = re.match(r'^\s*(?:cwd|path|root|workspace|directory)\s*:\s*["\']?(.+?)["\']?\s*$', line)
                if m and under_root(m.group(1)):
                    return True
        except Exception:
            pass
    for f in sorted(d.glob("*.jsonl")):
        if under_root(first_cwd(f)):
            return True
    return False


def sweep_copilot(srcs: dict):
    # ~/.copilot/session-state/<session>/ with events.jsonl and workspace.yaml
    base = home() / ".copilot" / "session-state"
    if not base.is_dir():
        return
    for d in sorted(base.iterdir()):
        if d.is_dir() and classify(srcs, d, lambda d=d: copilot_dir_matches(d)):
            for f in files_under(d):
                yield f, Path("copilot") / d.name / f.relative_to(d)


def sweep_gemini(srcs: dict):
    # ~/.gemini/tmp/<sha256 of project path>/chats/*.json
    base = home() / ".gemini" / "tmp"
    if not base.is_dir():
        return
    hashes = {hashlib.sha256(str(p).encode("utf-8")).hexdigest() for p in (root(), canonical(root()))}

    def chats_match(d: Path) -> bool:
        chats = d / "chats"
        return chats.is_dir() and any(under_root(first_cwd(f)) for f in sorted(chats.glob("*.json*")))

    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        if d.name in hashes or classify(srcs, d, lambda d=d: chats_match(d)):
            for f in files_under(d):
                yield f, Path("gemini") / d.name / f.relative_to(d)


ADAPTERS = {
    "claude": sweep_claude,
    "cursor": sweep_cursor,
    "codex": sweep_codex,
    "copilot": sweep_copilot,
    "gemini": sweep_gemini,
}


def sweep(tools=TOOLS) -> dict:
    """Copy every session of the given tools that ran inside this repo. Returns copied counts."""
    ensure_logs()
    state = load_state()
    srcs = state.setdefault("sources", {})
    copied = {}
    for tool in tools:
        n = 0
        try:
            for src, rel in ADAPTERS[tool](srcs):
                if copy_file(src, rel):
                    n += 1
        except Exception as exc:
            log(f"sweep {tool}: {exc}")
        copied[tool] = n
    state["last_sweep"] = now_iso()
    save_state(state)
    return copied


# ── .logs folder scaffolding ────────────────────────────────────────────────

LOGS_README = """This folder is written by tools/ai-logs/collect.py (see README.md, section
"We record your AI coding sessions").

<tool>/<session>.jsonl   full transcript copied from the tool's own local store
<tool>/events.jsonl      prompt, edit and lifecycle events seen by the hooks
manual/                  web-chat exports you add yourself (ChatGPT, claude.ai, Gemini)
manifest.json            written by ./submit.sh: file list with checksums
.state.json              bookkeeping, never included in the zip

Nothing here leaves your machine until you run ./submit.sh and upload the zip.
"""

MANUAL_README = """Put exports of web-chat conversations here (ChatGPT, claude.ai, Gemini, ...).

Any format works: a shared link in a .txt file, a copied-and-pasted conversation
as .md, or the tool's own export (JSON, HTML). One file per conversation is ideal.
"""


def ensure_logs() -> None:
    d = logs_dir()
    try:
        (d / "manual").mkdir(parents=True, exist_ok=True)
        readme = d / "README.txt"
        if not readme.exists():
            readme.write_text(LOGS_README, encoding="utf-8")
        mreadme = d / "manual" / "README.txt"
        if not mreadme.exists():
            mreadme.write_text(MANUAL_README, encoding="utf-8")
    except Exception as exc:
        log(f"ensure_logs: {exc}")


def append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


# ── commands ────────────────────────────────────────────────────────────────

def cmd_hook(tool: str, event_arg: str = "") -> int:
    """Called by a tool's hook. Must be quiet and must never fail the calling tool."""
    try:
        if tool not in TOOLS:
            tool = "other"
        ensure_logs()
        raw = "" if sys.stdin is None or sys.stdin.isatty() else sys.stdin.read()
        try:
            data = json.loads(raw) if raw.strip() else {}
        except Exception:
            data = {"raw": raw[:2000]}
        if not isinstance(data, dict):
            data = {"raw": raw[:2000]}
        event = str(data.get("hook_event_name") or data.get("hookEventName") or data.get("event")
                    or event_arg or data.get("type") or "")
        sid = str(data.get("session_id") or data.get("sessionId") or data.get("conversation_id") or "")
        record = {"ts": now_iso(), "tool": tool, "event": event, "session_id": sid}
        for k in EVENT_KEYS:
            if k in data:
                record[k] = data[k]
        if "raw" in data:
            record["raw"] = data["raw"]
        append_jsonl(logs_dir() / tool / "events.jsonl", record)

        tp = data.get("transcript_path")
        if isinstance(tp, str) and tp:
            p = canonical(tp)
            if p.is_file():
                copy_file(p, Path(tool) / p.name)
                extra = p.parent / p.stem
                if tool == "claude" and extra.is_dir():
                    for sub in files_under(extra):
                        copy_file(sub, Path(tool) / p.stem / sub.relative_to(extra))

        tools = TOOLS if (not event or event.lower() in FULL_SWEEP_EVENTS) else (tool,)
        if tool == "other":
            tools = TOOLS
        sweep(tools)
    except Exception as exc:
        log(f"hook {tool}: {exc}")
    return 0


def inventory() -> dict:
    sessions = []
    prompts = {}
    for tool in TOOLS:
        d = logs_dir() / tool
        if not d.is_dir():
            continue
        for f in sorted(d.iterdir()):
            if f.is_file() and f.name == "events.jsonl":
                try:
                    with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                        prompts[tool] = sum(1 for line in fh if '"prompt"' in line)
                except Exception:
                    prompts[tool] = 0
            elif f.is_file():
                st = f.stat()
                sessions.append({
                    "tool": tool,
                    "file": str(f.relative_to(logs_dir())),
                    "bytes": st.st_size,
                    "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                })
            elif f.is_dir():  # per-session folders (Copilot, Gemini, Claude tool results)
                total = sum(x.stat().st_size for x in files_under(f))
                newest = max((x.stat().st_mtime for x in files_under(f)), default=f.stat().st_mtime)
                sessions.append({
                    "tool": tool,
                    "file": str(f.relative_to(logs_dir())) + "/",
                    "bytes": total,
                    "modified": datetime.fromtimestamp(newest, timezone.utc).isoformat(timespec="seconds"),
                })
    manual_dir = logs_dir() / "manual"
    manual = [str(f.relative_to(logs_dir())) for f in files_under(manual_dir)
              if f.name != "README.txt"] if manual_dir.is_dir() else []
    return {"sessions": sessions, "prompts": prompts, "manual": manual}


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} GB"


def print_inventory(inv: dict) -> None:
    print(f"\nAI session logs in {logs_dir()}\n")
    if inv["sessions"]:
        w = max(len(s["file"]) for s in inv["sessions"])
        print(f"  {'tool':8} {'session':{w}}  {'size':>9}  last modified (UTC)")
        for s in inv["sessions"]:
            print(f"  {s['tool']:8} {s['file']:{w}}  {human(s['bytes']):>9}  {s['modified']}")
    else:
        print("  no tool sessions found")
    for tool, n in sorted(inv["prompts"].items()):
        print(f"  {tool}: {n} prompt(s) recorded live by hooks")
    if inv["manual"]:
        print(f"\n  manual exports ({len(inv['manual'])}):")
        for m in inv["manual"]:
            print(f"    {m}")
    else:
        print("\n  manual exports: none")
    print()


def cmd_sweep() -> int:
    copied = sweep()
    total = sum(copied.values())
    print("copied " + ", ".join(f"{k}={v}" for k, v in copied.items()) + f" (total {total})")
    print_inventory(inventory())
    return 0


def cmd_status() -> int:
    ensure_logs()
    print_inventory(inventory())
    return 0


# ── secret masking ──────────────────────────────────────────────────────────

SECRET_PATTERNS = [
    re.compile(r"sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b"),
    re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]
ASSIGNMENT_PATTERN = re.compile(
    r"(?i)((?:api[_\-]?key|secret[_\-]?key|access[_\-]?token|auth[_\-]?token|password|passwd|client[_\-]?secret)"
    r"\s*[=:]\s*(?:\\\\?[\"'])?)([A-Za-z0-9_\-/+.]{16,})"
)  # the optional backslash covers quotes escaped inside JSON transcript lines
REDACTED = "[REDACTED]"


def scrub_text(text: str):
    n = 0
    for pat in SECRET_PATTERNS:
        text, k = pat.subn(REDACTED, text)
        n += k
    text, k = ASSIGNMENT_PATTERN.subn(lambda m: m.group(1) + REDACTED, text)
    n += k
    return text, n


def scrub_file(path: Path) -> int:
    try:
        if path.stat().st_size > MAX_SCRUB_BYTES:
            return 0
        text = path.read_text(encoding="utf-8")  # strict: binary files raise and are left alone
    except Exception:
        return 0
    text, n = scrub_text(text)
    if n:
        path.write_text(text, encoding="utf-8")
    return n


def scrub_logs() -> dict:
    counts = {}
    skip = {"manifest.json", ".state.json", "README.txt"}
    for f in files_under(logs_dir()):
        if f.name in skip:
            continue
        n = scrub_file(f)
        if n:
            counts[str(f.relative_to(logs_dir()))] = n
    return counts


# ── submit ──────────────────────────────────────────────────────────────────

def ask_yes_no(question: str, default: bool) -> bool:
    hint = "[Y/n]" if default else "[y/N]"
    try:
        answer = input(f"{question} {hint} ").strip().lower()
    except EOFError:
        return default
    if not answer:
        return default
    return answer in ("y", "yes", "j", "ja")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def tool_versions() -> dict:
    out = {}
    for tool, cmd in (("claude", ["claude", "--version"]), ("codex", ["codex", "--version"]),
                      ("cursor", ["cursor-agent", "--version"]), ("copilot", ["copilot", "--version"]),
                      ("gemini", ["gemini", "--version"])):
        if not shutil.which(cmd[0]):
            out[tool] = None
            continue
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
            out[tool] = (r.stdout or r.stderr).strip().splitlines()[0] if (r.stdout or r.stderr).strip() else "installed"
        except Exception:
            out[tool] = "installed"
    return out


def git_head() -> str:
    try:
        r = subprocess.run(["git", "-C", str(root()), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=8)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache",
             "dist", "build", "target", ".next", ".nuxt", ".turbo", ".cache", ".logs"}


def repo_files() -> list:
    """Files to ship: tracked plus untracked-but-not-ignored when git works, else a filtered walk."""
    r = root()
    try:
        out = subprocess.run(
            ["git", "-C", str(r), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True, timeout=30,
        )
        if out.returncode == 0:
            files = [r / p.decode("utf-8", "surrogateescape") for p in out.stdout.split(b"\0") if p]
            return [f for f in files if f.is_file() and not noise(f)]
    except Exception:
        pass
    files = []
    for dirpath, dirnames, filenames in os.walk(r):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            f = Path(dirpath) / name
            if not noise(f):
                files.append(f)
    return files


def noise(f: Path) -> bool:
    """Files that never belong in a submission even when git does not ignore them."""
    if "__pycache__" in f.parts or f.suffix == ".pyc" or f.name == ".DS_Store":
        return True
    return f.name.startswith("submission-") and f.suffix == ".zip"


def cmd_submit(yes: bool = False, no_ai: bool = False) -> int:
    r = root()
    print(f"\nPreparing the submission for {r}")
    copied = sweep()
    print("sweep: " + ", ".join(f"{k} +{v}" for k, v in copied.items()))
    inv = inventory()
    print_inventory(inv)

    declarations = {"used_web_chat": None, "no_ai_tools_used": False}
    if not yes:
        used_web = ask_yes_no("Did you use a web chat (ChatGPT, claude.ai, Gemini, ...) for this challenge?", False)
        declarations["used_web_chat"] = used_web
        if used_web and not inv["manual"]:
            print(f"\nPlease export or paste those conversations into {logs_dir() / 'manual'} first,\n"
                  "then run ./submit.sh again. See .logs/manual/README.txt for what works.\n")
            return 1
    if not inv["sessions"] and not inv["manual"]:
        if no_ai or yes:
            declarations["no_ai_tools_used"] = bool(no_ai)
        else:
            if ask_yes_no("No AI sessions were found. Confirm that you did not use AI coding tools for this challenge?", False):
                declarations["no_ai_tools_used"] = True
            else:
                print("\nIf you did use a tool and nothing was found, run with AI_LOGS_DEBUG=1 ./submit.sh\n"
                      "and send us the output together with the zip, or export the sessions by hand into .logs/manual/.\n")
                return 1

    redactions = scrub_logs()
    if redactions:
        total = sum(redactions.values())
        print(f"masked {total} secret-looking value(s) in {len(redactions)} file(s); details in manifest.json")

    entries = []
    for f in files_under(logs_dir()):
        if f.name in (".state.json", "manifest.json") or f.suffix == ".tmp":
            continue
        rel = str(f.relative_to(logs_dir()))
        tool = rel.split("/", 1)[0]
        entries.append({"path": rel, "tool": tool if tool in TOOLS else "manual" if tool == "manual" else "other",
                        "bytes": f.stat().st_size, "sha256": sha256_of(f)})
    manifest = {
        "version": 1,
        "collector_version": VERSION,
        "generated_at": now_iso(),
        "repository": r.name,
        "git_head": git_head(),
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "tool_versions": tool_versions(),
        "declarations": declarations,
        "redactions": redactions,
        "prompts_recorded_by_hooks": inv["prompts"],
        "files": entries,
    }
    manifest_path = logs_dir() / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    zip_path = r / f"submission-{r.name}-{stamp}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in repo_files():
            if f == zip_path:
                continue
            zf.write(f, str(f.relative_to(r)))
        for f in files_under(logs_dir()):
            if f.name == ".state.json" or f.suffix == ".tmp":
                continue
            zf.write(f, str(f.relative_to(r)))
    size = zip_path.stat().st_size
    print(f"\nWrote {zip_path} ({human(size)}), {len(entries)} log file(s) included.")
    print("Upload this file on your challenge page in the RIZM Operation Center.\n")
    return 0


def main(argv) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd == "hook":
        return cmd_hook(args[0] if args else "other", args[1] if len(args) > 1 else "")
    if cmd == "sweep":
        return cmd_sweep()
    if cmd == "status":
        return cmd_status()
    if cmd == "submit":
        return cmd_submit(yes="--yes" in args, no_ai="--no-ai" in args)
    print(f"unknown command {cmd!r}\n\n{__doc__.strip()}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
