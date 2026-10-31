"""Tests for the AI session log collector. Run: python3 -m unittest discover tools/ai-logs/tests"""
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
COLLECT = HERE.parent / "collect.py"


def load_collect(root: Path, home: Path):
    os.environ["AI_LOGS_ROOT"] = str(root)
    os.environ["AI_LOGS_HOME"] = str(home)
    spec = importlib.util.spec_from_file_location("collect", COLLECT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def jsonl(path: Path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name).resolve()
        self.root = base / "repo"
        self.home = base / "home"
        self.root.mkdir()
        self.home.mkdir()
        (self.root / "main.py").write_text("print('hi')\n")
        self.c = load_collect(self.root, self.home)
        self.env = dict(os.environ, AI_LOGS_ROOT=str(self.root), AI_LOGS_HOME=str(self.home))

    def tearDown(self):
        self.tmp.cleanup()

    # ── sweep adapters ──────────────────────────────────────────────────

    def test_claude_sweep_copies_matching_session_and_its_folder(self):
        proj = self.home / ".claude" / "projects" / "-repo"
        jsonl(proj / "sid-1.jsonl", [
            {"type": "file-history-snapshot", "snapshot": {}},
            {"type": "user", "cwd": str(self.root), "message": {"role": "user", "content": "hello"}},
        ])
        jsonl(proj / "sid-2.jsonl", [{"type": "user", "cwd": str(self.home / "elsewhere")}])
        sub = proj / "sid-1" / "tool-results"
        sub.mkdir(parents=True)
        (sub / "r1.txt").write_text("result")
        # a session launched in a subfolder of the repo counts too
        jsonl(proj / "sid-3.jsonl", [{"type": "user", "cwd": str(self.root / "src")}])

        copied = self.c.sweep(("claude",))
        self.assertEqual(copied["claude"], 3)
        logs = self.root / ".logs" / "claude"
        self.assertTrue((logs / "sid-1.jsonl").is_file())
        self.assertTrue((logs / "sid-1" / "tool-results" / "r1.txt").is_file())
        self.assertTrue((logs / "sid-3.jsonl").is_file())
        self.assertFalse((logs / "sid-2.jsonl").exists())
        # second sweep is a no-op
        self.assertEqual(self.c.sweep(("claude",))["claude"], 0)

    def test_cursor_sweep_matches_slug_only(self):
        slug = self.c.cursor_slug(self.root)
        good = self.home / ".cursor" / "projects" / slug / "agent-transcripts" / "c1"
        jsonl(good / "c1.jsonl", [{"role": "user", "message": {"content": [{"type": "text", "text": "hi"}]}}])
        sibling = self.home / ".cursor" / "projects" / (slug + "-notes") / "agent-transcripts" / "c2"
        jsonl(sibling / "c2.jsonl", [{"role": "user"}])
        copied = self.c.sweep(("cursor",))
        self.assertEqual(copied["cursor"], 1)
        self.assertTrue((self.root / ".logs" / "cursor" / "c1" / "c1.jsonl").is_file())
        self.assertFalse((self.root / ".logs" / "cursor" / "c2").exists())

    def test_codex_sweep_reads_session_meta(self):
        day = self.home / ".codex" / "sessions" / "2026" / "10" / "08"
        jsonl(day / "rollout-2026-10-08T10-00-00-abc.jsonl", [
            {"timestamp": "t", "type": "session_meta", "payload": {"id": "abc", "cwd": str(self.root)}},
            {"timestamp": "t", "type": "response_item", "payload": {"type": "message"}},
        ])
        jsonl(day / "rollout-2026-10-08T11-00-00-def.jsonl", [
            {"timestamp": "t", "item_type": "session_meta", "payload": {"cwd": "/somewhere/else"}},
        ])
        copied = self.c.sweep(("codex",))
        self.assertEqual(copied["codex"], 1)
        self.assertTrue((self.root / ".logs" / "codex" / "rollout-2026-10-08T10-00-00-abc.jsonl").is_file())

    def test_copilot_sweep_uses_workspace_yaml(self):
        s = self.home / ".copilot" / "session-state" / "sess-1"
        s.mkdir(parents=True)
        (s / "workspace.yaml").write_text(f"id: sess-1\ncwd: {self.root}\n")
        (s / "events.jsonl").write_text('{"type":"user.message","data":{"content":"hi"}}\n')
        other = self.home / ".copilot" / "session-state" / "sess-2"
        other.mkdir(parents=True)
        (other / "workspace.yaml").write_text("cwd: /tmp/other\n")
        (other / "events.jsonl").write_text("{}\n")
        copied = self.c.sweep(("copilot",))
        self.assertEqual(copied["copilot"], 2)
        self.assertTrue((self.root / ".logs" / "copilot" / "sess-1" / "events.jsonl").is_file())
        self.assertFalse((self.root / ".logs" / "copilot" / "sess-2").exists())

    def test_gemini_sweep_matches_project_hash(self):
        h = hashlib.sha256(str(self.root).encode()).hexdigest()
        chats = self.home / ".gemini" / "tmp" / h / "chats"
        chats.mkdir(parents=True)
        (chats / "session-1.json").write_text(json.dumps({"sessionId": "1", "messages": []}, indent=2))
        other = self.home / ".gemini" / "tmp" / ("0" * 64) / "chats"
        other.mkdir(parents=True)
        (other / "session-2.json").write_text("{}")
        copied = self.c.sweep(("gemini",))
        self.assertEqual(copied["gemini"], 1)
        self.assertTrue((self.root / ".logs" / "gemini" / h / "chats" / "session-1.json").is_file())

    def test_sweep_survives_missing_stores(self):
        self.assertEqual(sum(self.c.sweep().values()), 0)
        self.assertTrue((self.root / ".logs" / "README.txt").is_file())
        self.assertTrue((self.root / ".logs" / "manual" / "README.txt").is_file())

    # ── hook mode ───────────────────────────────────────────────────────

    def test_hook_records_event_and_copies_transcript(self):
        transcript = self.home / ".claude" / "projects" / "-repo" / "sid-9.jsonl"
        jsonl(transcript, [{"type": "user", "cwd": str(self.root), "message": {"content": "x"}}])
        payload = {"hook_event_name": "UserPromptSubmit", "session_id": "sid-9",
                   "transcript_path": str(transcript), "cwd": str(self.root), "prompt": "write tests"}
        r = subprocess.run([sys.executable, str(COLLECT), "hook", "claude"], input=json.dumps(payload),
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "", "hook must stay silent on stdout")
        events = (self.root / ".logs" / "claude" / "events.jsonl").read_text().splitlines()
        self.assertEqual(len(events), 1)
        rec = json.loads(events[0])
        self.assertEqual(rec["event"], "UserPromptSubmit")
        self.assertEqual(rec["prompt"], "write tests")
        self.assertTrue((self.root / ".logs" / "claude" / "sid-9.jsonl").is_file())

    def test_hook_takes_event_argument_and_camelcase_ids(self):
        # Copilot CLI payloads carry sessionId and no event name; the config passes the event as an argument.
        payload = {"sessionId": "cp-1", "cwd": str(self.root), "prompt": "fix the bug", "timestamp": 1}
        r = subprocess.run([sys.executable, str(COLLECT), "hook", "copilot", "userPromptSubmitted"],
                           input=json.dumps(payload), capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0)
        rec = json.loads((self.root / ".logs" / "copilot" / "events.jsonl").read_text().splitlines()[0])
        self.assertEqual(rec["event"], "userPromptSubmitted")
        self.assertEqual(rec["session_id"], "cp-1")
        self.assertEqual(rec["prompt"], "fix the bug")

    def test_hook_tolerates_garbage_and_empty_stdin(self):
        for data in ("", "not json", "[1,2]"):
            r = subprocess.run([sys.executable, str(COLLECT), "hook", "cursor"], input=data,
                               capture_output=True, text=True, env=self.env)
            self.assertEqual(r.returncode, 0)
        events = (self.root / ".logs" / "cursor" / "events.jsonl").read_text().splitlines()
        self.assertEqual(len(events), 3)

    # ── scrub ───────────────────────────────────────────────────────────

    def test_scrub_masks_secrets_and_keeps_json_valid(self):
        line = json.dumps({"message": "use sk-ant-api03-" + "A" * 40 + " and ghp_" + "b" * 36
                           + ' then API_KEY="' + "c" * 24 + '" ok'})
        text, n = self.c.scrub_text(line)
        self.assertEqual(n, 3)
        obj = json.loads(text)
        self.assertNotIn("A" * 40, obj["message"])
        self.assertIn("[REDACTED]", obj["message"])
        self.assertIn('API_KEY="[REDACTED]"', obj["message"])

    def test_scrub_leaves_ordinary_text_alone(self):
        text, n = self.c.scrub_text("def password_check(value): return len(value) > 8")
        self.assertEqual(n, 0)

    # ── submit ──────────────────────────────────────────────────────────

    def test_submit_builds_zip_with_manifest_and_without_state(self):
        proj = self.home / ".claude" / "projects" / "-repo"
        jsonl(proj / "sid-1.jsonl", [{"type": "user", "cwd": str(self.root), "message": {"content": "AKIA" + "Q" * 16}}])
        (self.root / ".logs" / "manual").mkdir(parents=True)
        (self.root / ".logs" / "manual" / "chatgpt.md").write_text("# chat\n")
        r = subprocess.run([sys.executable, str(COLLECT), "submit", "--yes"], capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        zips = list(self.root.glob("submission-*.zip"))
        self.assertEqual(len(zips), 1)
        with zipfile.ZipFile(zips[0]) as zf:
            names = set(zf.namelist())
        self.assertIn("main.py", names)
        self.assertIn(".logs/claude/sid-1.jsonl", names)
        self.assertIn(".logs/manual/chatgpt.md", names)
        self.assertIn(".logs/manifest.json", names)
        self.assertNotIn(".logs/.state.json", names)
        self.assertFalse(any(n.startswith("submission-") for n in names))
        manifest = json.loads((self.root / ".logs" / "manifest.json").read_text())
        self.assertEqual(manifest["redactions"], {"claude/sid-1.jsonl": 1})
        paths = {f["path"] for f in manifest["files"]}
        self.assertIn("claude/sid-1.jsonl", paths)
        self.assertEqual(manifest["declarations"]["no_ai_tools_used"], False)
        scrubbed = (self.root / ".logs" / "claude" / "sid-1.jsonl").read_text()
        self.assertNotIn("AKIA" + "Q" * 16, scrubbed)

    def test_submit_without_sessions_records_declaration(self):
        r = subprocess.run([sys.executable, str(COLLECT), "submit", "--yes", "--no-ai"],
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        manifest = json.loads((self.root / ".logs" / "manifest.json").read_text())
        self.assertTrue(manifest["declarations"]["no_ai_tools_used"])


if __name__ == "__main__":
    unittest.main()
