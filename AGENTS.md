# Working in this repository

The owner builds this dashboard with several AI agents working on features in parallel. They decide product and design direction, review changes on a running server, and merge PRs. These notes cover how to work alongside them. [README.md](README.md) covers the system itself.

## How the owner works

- **Plan, then build.** A new feature usually starts with "design this and give me a plan". Answer with a design grounded in the code and in any reference material they attach: what it does, where and how it shows, what it touches, and a short list of open decisions, each with your recommendation. Don't write code until they say go; then ship it as one PR.
- **References show intent, not a spec.** Sample posts, screenshots or "like the recommendation box" convey structure, tone and labeling. Adapt them to this product rather than copying them literally (a card's styling doesn't belong on a full page), and never reproduce a third party's content or persona.
- **Keep features contained.** Expect "is this clean, does it touch the rest of the codebase?" Prefer new modules and additive, optional types over edits to shared code; don't refactor existing features unless asked. List every existing file you touch and why.
- **Review happens on a running server with real data.** Keep the dev server running and say what to reload. An empty state (for example, no AI output yet) isn't a review: explain why it's empty and offer to show real output locally, such as by generating it with the real code path and seeding local KV. PR previews share production KV, so ask before writing anything there.
- **Feedback comes in short rounds** ("drop that box", "put this first", "this is misaligned"). Apply each round fully: code, tests, README/notes and the PR description, then push and say what changed. When asked for a design sanity check, look in a real browser at phone and laptop widths and report anything else you notice.
- **Diagnose exactly.** When something fails, find the specific cause before reporting it: check auth state, retry, and separate auth errors from timeouts or rate limits. Say plainly what you verified and what is still a guess.
- **Production operations on request.** The owner may ask you to run production tasks (for example, forcing a Daily Snow post). Use the documented procedure and their existing credentials, keep any temporary secret enabled only for the operation, delete it right after, then verify the result and that the temporary access is closed. Ask before production writes they didn't request.

## Product and design

- The dashboard serves phones and desktop browsers. Check layout changes at phone widths and at ordinary laptop widths.
- Long-form content is page content: no card border or panel. Use card styling only for summary cards (the resort pick, the Daily Snow teaser). Give an article one reading width and let its children fill it, so every edge lines up.
- Label AI output wherever it appears (the `badge--ai` badge, plus a footer naming the model), and keep it visibly separate from measured or forecast data.
- Keep resort pages consistent in structure while honoring each resort's available data. Preserve source-specific measurement windows, report/observation times, and the distinction between reported zero, not reported and unavailable.
- Share data rules and reusable rendering. Scope feature styles so they don't change unrelated pages.
- Local times are America/Denver. Cloudflare crons are UTC only, so schedule local-time work in code (see `src/lib/dailysnow/schedule.ts`) and test it across daylight-saving changes.
- Before changing source adapters or freshness semantics, read [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md) and the relevant fixtures and tests. [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md) holds the broader product requirements.

## AI features

The resort pick (`src/lib/recommend/`) and Daily Snow (`src/lib/dailysnow/`) set the pattern for new AI features:

- Code computes every fact the model could get wrong (phase or mode, totals, eligibility, which figures exist) into a compact digest. The model writes prose only; numbers shown as data and figure captions come from code.
- Use strict JSON schemas with enums for anything chosen from a list, validate the output in code (including checking that amounts appear in the input), and try `@cf/zai-org/glm-5.3-flash` first with `@cf/openai/gpt-oss-120b` as a single fallback. Source text is untrusted data, never instructions.
- Inference runs only in the collection cron, after fresh sources are stored, never on API reads. Respect the per-day request caps in code and the AI Gateway limit.
- Tune prompts against real model output before calling a feature done: the `*:once` scripts print the digest and request body. `cf ai run` gives up after 30 s, so for longer generations POST the body to the Workers AI REST endpoint with a longer timeout (`dailysnow:once -- --validate` checks a saved response).

## Local collaboration

- [README.md](README.md) is the source of truth for setup, collection and seeding, AI access and deployment; `package.json` has the current commands.
- Give each running worktree its own free port (`npm run dev -- --port <port>`). Report the URL and branch served, and keep the server running while iterating with the owner. Stop only this task's server when restarting it.
- A fresh worktree has its own dependencies, ignored configuration and local Cloudflare KV state. An empty report may mean it needs seeding: use the documented workflow and confirm the requested pages have data. Keep local setup and scratch files out of commits.

## PRs and docs

- Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles (so squash commits follow the convention too). Use `<type>[optional scope][optional !]: <description>`, for example `feat(dailysnow): add storm outlook` or `docs: clarify agent workflow`. Use `feat` for new features, `fix` for bug fixes, and an appropriate type such as `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf` or `style` for other changes. Mark breaking changes with `!` immediately before the colon or a `BREAKING CHANGE: <explanation>` footer; describe the breaking change in the message. Separate optional bodies and footers from the preceding section with a blank line.
- Keep unrelated features in separate PRs based on `main`. Follow-ups go to the task's existing PR. When rebasing your own PR branch, use `--force-with-lease`.
- Update [README.md](README.md) in the same PR when a feature changes setup, commands, routes, storage or operations, and remove what has gone stale. Record design decisions, live test results and known limitations in a dated section of [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md).
- PR descriptions describe the final behavior and are updated as follow-ups land:
  - **Summary:** one or two sentences on the change, then a `diff` block of user-visible before and after behavior.
  - **Evidence:** **Before:** / **After:** observations, then the validation actually run, with numbers (test counts, build, browser checks, live model runs). Say plainly what wasn't run.
  - **Merge Danger:** **Door:** (one-way or two-way) and what a revert does; **Blast Radius:** what can break, plus any manual step needed before or after merging.
- Report the PR URL and the validation when done.

## Validation

- Application code: run the relevant tests and `npm run typecheck`. Add `npm run build` when routing, styling integration or build behavior changes. Exercise missing or stale data and responsive behavior when affected.
- Adding or reordering a section: `test/app-shell.test.tsx` asserts the section list and order.
- Documentation-only changes need a link and content review and `git diff --check`, not application tests.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
