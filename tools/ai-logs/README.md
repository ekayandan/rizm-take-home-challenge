# AI session log collector

Everything in this folder exists for one purpose: to copy the transcripts of the AI
coding sessions you run inside this repository into the hidden `.logs/` folder, so
they can be handed in together with your code. The README at the repository root
explains why.

## How it works

Every supported tool already keeps a complete transcript of each session on your
machine, keyed by the folder the session ran in:

| Tool | Local store | Matched by |
|---|---|---|
| Claude Code | `~/.claude/projects/<folder>/<session>.jsonl` | `cwd` field in the transcript |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `cwd` in the session metadata |
| Cursor | `~/.cursor/projects/<folder>/agent-transcripts/` | folder name derived from the path |
| Copilot CLI | `~/.copilot/session-state/<session>/` | `workspace.yaml` or the event log |
| Gemini CLI | `~/.gemini/tmp/<hash of path>/chats/` | hash of the repository path |

`collect.py` has two ways in:

- **hook** mode is called by the hook configurations committed in this repo
  (`.claude/settings.json`, `.cursor/hooks.json`, `.codex/config.toml`,
  `.gemini/settings.json`, `.github/hooks/`). Each call appends one line to
  `.logs/<tool>/events.jsonl` (prompts, edits, session start and end), copies the
  transcript the tool points it to, and then runs a sweep.
- **sweep** mode reads the stores above and copies every session whose working
  directory is this repository or a folder inside it. It is idempotent and runs
  again inside `./submit.sh`, so a session is collected even if the hook never
  fired, for example because you declined a tool's trust prompt.

`./submit.sh` runs the sweep, shows the sessions it found, asks whether you used a
web chat, masks values that look like API keys or private keys (the counts land in
`manifest.json`), writes `manifest.json` with a checksum per file, and zips the
repository together with `.logs/`. Only the `.logs/.state.json` bookkeeping file is
left out of the zip, because it lists paths of sessions from your other projects.

Nothing is uploaded by this code. The zip only goes where you upload it.

## Running it yourself

```sh
python3 tools/ai-logs/collect.py status   # what .logs/ holds right now
python3 tools/ai-logs/collect.py sweep    # collect without building the zip
AI_LOGS_DEBUG=1 ./submit.sh               # verbose, if a session seems to be missing
python3 -m unittest discover tools/ai-logs/tests   # the collector's own tests
```

Python 3.13 or newer, standard library only.
