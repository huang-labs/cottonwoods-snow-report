# Working in this repository

## Isolate every new chat

The owner runs agents on parallel features. Every new chat must own a separate Git worktree and feature branch before editing files, installing dependencies, or starting a dev server.

1. Inspect `git status --short`, `git branch --show-current`, and `git worktree list` in the starting checkout. Treat existing worktrees, branches, uncommitted changes, and running servers as another task's work unless explicitly assigned to this chat.
2. Use a worktree and branch provisioned specifically for this chat if available. Otherwise fetch origin and create a new worktree on a unique task branch from the latest remote default branch (`origin/main` here), rather than from the starting checkout's feature branch. Base on another feature only when the task explicitly depends on it. For example, replacing the placeholders:
   ```sh
   git fetch origin
   git worktree add -b <task-branch> ../snow-report-<task> origin/main
   ```
3. Run all edits, installs, checks, commits, and servers from that worktree. State its path and branch when work begins. Keep using it for follow-ups in the same chat, including after context compaction.

Never switch branches in another task's checkout, or stash, reset, clean, commit, or overwrite its changes. Worktrees isolate files, but Git refs remain shared: avoid changing another task's branch. Leave worktrees and servers in place for ongoing collaboration; remove only resources owned by this task when cleanup is requested.

## Local collaboration

- For setup, collection/seeding, AI access, or deployment work, read the relevant section of [README.md](README.md). It is the source of truth for those workflows; consult `package.json` for current commands.
- Give each running worktree its own available port (`npm run dev -- --port <port>`). Report the URL and branch being served; keep that server running while iterating with the owner. Stop only this task's server when restarting it.
- A fresh worktree has its own dependencies, ignored configuration, and local Cloudflare KV state. An empty report may mean it needs local seeding. Use the documented local workflow and verify the requested pages have data. Keep local setup out of commits.
- Keep unrelated features in separate PRs based on the default branch. Update the task's existing PR for follow-up changes, describe the final behavior, and report the PR URL and validation. When rebasing your own PR branch, preserve concurrent remote updates with `--force-with-lease`.

## Product and implementation

- This dashboard serves mobile, desktop, and a TV slideshow. For layout changes, check the affected modes, including ordinary laptop widths. Browse reports can scroll; TV content needs a deliberate viewport budget.
- Keep resort pages consistent in structure while honoring each resort's available data. Preserve source-specific measurement windows, report/observation times, and the distinction between reported zero, not reported, and unavailable.
- Share data rules and reusable rendering. Keep browse and TV markup separate where their reading and interaction needs differ; select the presentation at the section renderer rather than scattering mode checks throughout the layouts.
- Prefer focused changes and small refactors with a concrete payoff. Scope feature styles so they do not alter unrelated pages or the other presentation mode.
- Before changing source adapters or freshness semantics, read [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md) and the relevant fixtures/tests. Consult [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md) for broader product requirements.
- Run checks appropriate to the change. For application code, run the relevant tests and type checking; include a production build when routing, styling integration, or build behavior changes. Exercise missing/stale data and responsive behavior when affected. Documentation-only changes need link/content review and `git diff --check`, rather than application tests.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
