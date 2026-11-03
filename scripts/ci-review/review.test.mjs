import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { eligible, selectReviewer, sameReviewTarget, renderReview, validateResult, classifyFailure, publish, MARKER, MODELS } from "./review.mjs";

const repository = "owner/repo";
const pr = {
  number: 12, state: "open", draft: false, user: { login: "owner" },
  head: { sha: "a".repeat(40), repo: { full_name: repository } },
  base: { sha: "b".repeat(40) }, labels: [{ name: "author:codex" }],
};
const event = { action: "synchronize", sender: { type: "User" }, pull_request: pr };
const result = { review: { key_issues_to_review: [], security_concerns: "No" }, coverage: { files_not_reviewed: [], files_partially_reviewed: [] }, usage: { total_tokens: 125 } };

for (const author of Object.keys(MODELS)) {
  test(`${author}: selects each other family across PR numbers and stays stable`, () => {
    const families = new Set();
    for (const number of [12, 13]) {
      const selected = selectReviewer([`author:${author}`], number);
      assert.notEqual(selected.family, author);
      assert.equal(selected.model, MODELS[selected.family]);
      assert.deepEqual(selectReviewer(["other", `author:${author}`], number), selected);
      families.add(selected.family);
    }
    assert.equal(families.size, 2);
  });
}

test("missing and conflicting labels explain the skip", () => {
  for (const labels of [[], ["author:other"], ["author:codex", "author:claude"]]) {
    assert.match(selectReviewer(labels, 12).reason, /exactly one/);
  }
});

test("model overrides preserve the chosen vendor", () => {
  assert.equal(selectReviewer(["author:codex"], 12, { claude: "anthropic/claude-opus-5" }).model, "anthropic/claude-opus-5");
  for (const model of ["openrouter/auto", "openai/gpt-6.1-sol", "anthropic/claude-opus-5.5\n--arg", "anthropic/../auto"]) {
    assert.throws(() => selectReviewer(["author:codex"], 12, { claude: model }), /Invalid/);
  }
});

test("current same-repository PR events are eligible", () => {
  assert.equal(eligible("pull_request", event, pr, repository), true);
  assert.equal(eligible("pull_request", { ...event, action: "labeled", label: { name: "author:glm" } }, pr, repository), true);
});

for (const [name, changed] of [
  ["draft", { ...pr, draft: true }], ["closed", { ...pr, state: "closed" }],
  ["fork", { ...pr, head: { ...pr.head, repo: { full_name: "fork/repo" } } }],
  ["deleted fork", { ...pr, head: { ...pr.head, repo: null } }],
  ["Dependabot", { ...pr, user: { login: "dependabot[bot]" } }],
  ["old event", { ...pr, head: { ...pr.head, sha: "c".repeat(40) } }],
]) {
  test(`${name} cannot start inference`, () => assert.equal(eligible("pull_request", event, changed, repository), false));
}

test("unrelated labels and bot events are ignored", () => {
  assert.equal(eligible("pull_request", { ...event, action: "labeled", label: { name: "bug" } }, pr, repository), false);
  assert.equal(eligible("pull_request", { ...event, sender: { type: "Bot" } }, pr, repository), false);
});

const comment = { action: "created", sender: { type: "User" }, issue: { pull_request: {} }, comment: { body: "/review" } };
test("manual review needs an exact command and current write permission", () => {
  for (const permission of ["admin", "maintain", "write"]) assert.equal(eligible("issue_comment", comment, pr, repository, permission), true);
  for (const permission of ["read", "triage", undefined]) assert.equal(eligible("issue_comment", comment, pr, repository, permission), false);
  for (const body of ["hello", "/review --config.model=other", "/improve"]) assert.equal(eligible("issue_comment", { ...comment, comment: { body } }, pr, repository, "write"), false);
  assert.equal(eligible("issue_comment", { ...comment, issue: {} }, pr, repository, "write"), false);
});

test("head, base, routing, draft or state changes invalidate a running review", () => {
  assert.equal(sameReviewTarget(pr, pr), true);
  for (const changed of [
    { ...pr, head: { ...pr.head, sha: "new" } }, { ...pr, base: { sha: "new" } },
    { ...pr, labels: [{ name: "author:glm" }] }, { ...pr, labels: [] },
    { ...pr, draft: true }, { ...pr, state: "closed" },
  ]) assert.equal(sameReviewTarget(changed, pr), false);
  assert.equal(sameReviewTarget({ ...pr, labels: [...pr.labels, { name: "bug" }] }, pr), true);
});

test("structured output must contain findings and explicit coverage", () => {
  assert.equal(validateResult(result), result);
  for (const bad of [{}, { review: {} }, { ...result, coverage: {} }, { ...result, review: { key_issues_to_review: [null] } }]) {
    assert.throws(() => validateResult(bad), /Malformed/);
  }
});

test("review includes attribution, commit, coverage, usage, and escaped model text", () => {
  const body = renderReview({ repository, pr, selection: selectReviewer(["author:codex"], 12), runUrl: "https://github.com/run", result: {
    ...result, review: { key_issues_to_review: [{ relevant_file: "src/file name.ts", start_line: 9, issue_header: "Bug", issue_content: "@owner <script>oops</script>" }] },
    coverage: { files_not_reviewed: ["large.ts"], files_partially_reviewed: ["partial.ts"] },
  } });
  assert.ok(body.startsWith(MARKER));
  for (const value of [MODELS.claude, pr.head.sha, "large.ts", "partial.ts", "125", "src/file%20name.ts#L9", "@\u200bowner", "&lt;script&gt;"]) assert.ok(body.includes(value), value);
  assert.ok(!body.includes("<script>"));
});

test("failed review is never rendered as clean", () => {
  const body = renderReview({ repository, pr, selection: selectReviewer(["author:codex"], 12), failure: "review timeout", runUrl: "https://github.com/run" });
  assert.match(body, /Review failed/);
  assert.doesNotMatch(body, /No actionable findings/);
});

test("no-findings output remains advisory", () => {
  const body = renderReview({ repository, pr, selection: selectReviewer(["author:codex"], 12), result, runUrl: "https://github.com/run" });
  assert.match(body, /No actionable findings/);
  assert.match(body, /not a guarantee/);
});

test("missing author label produces a configuration notice without a model result", () => {
  assert.match(renderReview({ repository, pr, selection: selectReviewer([], 12) }), /No model request/);
});

test("provider errors are categorized without copying raw secret-bearing messages", () => {
  for (const [log, expected] of [["401 secret", /authentication/], ["402 balance", /credit/], ["429 retry", /rate limit/], ["timed out", /timeout/], ["404 unknown", /configuration/], ["traceback", /runtime/]]) {
    assert.match(classifyFailure(log), expected);
    assert.ok(!classifyFailure(log).includes("secret"));
  }
});

test("publisher paginates and edits only its own marked comment", async () => {
  const calls = [];
  const api = async (path, options) => {
    calls.push([path, options]);
    if (options) return {};
    if (path.endsWith("page=1")) return Array.from({ length: 100 }, (_, id) => ({ id, user: { login: "someone" }, body: MARKER }));
    return [
      { id: 101, user: { login: "github-actions[bot]" }, body: "### Preview\nurl" },
      { id: 102, user: { login: "github-actions[bot]" }, body: `${MARKER}\nold` },
    ];
  };
  await publish(repository, 12, "new", api);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], [`repos/${repository}/issues/comments/102`, { method: "PATCH", body: { body: "new" } }]);
});

test("publisher creates a comment when only preview and forged markers exist", async () => {
  const calls = [];
  await publish(repository, 12, "new", async (path, options) => {
    calls.push([path, options]);
    return options ? {} : [{ id: 1, user: { login: "human" }, body: MARKER }, { id: 2, user: { login: "github-actions[bot]" }, body: "### Preview\nurl" }];
  });
  assert.equal(calls.at(-1)[1].method, "POST");
});

test("workflow runs trusted base tooling and preview edits its own comment", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/review.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request.base.sha/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  const deploy = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.doesNotMatch(deploy, /--edit-last/);
  assert.match(deploy, /startswith\("### Preview/);
});
