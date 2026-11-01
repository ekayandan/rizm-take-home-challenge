# Agent working rules

Rules for agents working in parallel on this repo.

1. **One worktree, one issue.** Every worktree maps to one GitHub issue. The agent owns the issue's status: add the `in-progress` label when work starts (create the label if it is missing), and mark it done under rule 5.
2. **Task file.** While work is open, the task's context and progress live in `task-<issue>.md` at the repository root. It also holds the manual test steps: numbered, each with what to do and the expected outcome, written so someone can follow them without reading the code. Under rule 4 they move to the PR description with the rest of the file.
3. **PR evidence.** Every PR description shows before and after for:
   - the coverage report (the `npm test` command from `package.json` with `--experimental-test-coverage` added right after `node`)
   - screenshots, if applicable
   - other diagrams relevant to the change, if applicable
4. **Before asking for ready-to-merge.** Run `npm test` locally and make sure it passes. Then move the task file's context into the PR description and delete the file.
5. **Ready to merge.** Open PRs as drafts. A PR is ready to merge only after all checks pass and the user approves the manual tests.
6. **Done.** An issue is done only once its PR merges. Link it with `Closes #<issue>`, and remove `in-progress` when it closes.
7. **Ports.** Claim ports before starting a dev server, so servers don't clash.
   - Claims live in the gitignored `.ports` file at the root of the main checkout, which all worktrees share: `$(git rev-parse --path-format=absolute --git-common-dir)/../.ports`.
   - Add one line per port, `<port> <issue>`, using a port no other line lists. Start with `WEB_PORT` and `API_PORT` set to the claimed ports.
   - Stop the server and remove your lines when you're done with them, at the latest before the worktree is removed.
   - Do not stop your server before the user approves the manual tests (rule 5). They need it running to test.
