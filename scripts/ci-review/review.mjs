import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const IMAGE = "pragent/pr-agent@sha256:10a8893d5e081be1a5ae825843d9fc14f8e8d59d8a4f61d67c1775415156079f";
export const MARKER = "<!-- cottonwoods-ai-review:v1 -->";
export const MODELS = {
  claude: "anthropic/claude-opus-5.5",
  codex: "openai/gpt-6.1-sol",
  glm: "z-ai/glm-5.3",
};
const LABELS = Object.keys(MODELS).map((family) => `author:${family}`);

// Stable across pushes/retries; two possible reviewers, always outside the author family.
export function selectReviewer(labels, number, overrides = {}) {
  const authors = labels.filter((label) => LABELS.includes(label));
  if (authors.length !== 1) return { reason: "Apply exactly one author:codex, author:claude, or author:glm label. No model request was made." };
  const author = authors[0].slice(7);
  const candidates = Object.keys(MODELS).filter((family) => family !== author);
  const family = candidates[number % candidates.length];
  const model = overrides[family] || MODELS[family];
  // Overrides retain the selected vendor, and cannot select OpenRouter's auto routers.
  const vendor = MODELS[family].split("/")[0];
  if (!new RegExp(`^${vendor}/[a-zA-Z0-9._-]+$`).test(model)) throw new Error(`Invalid ${family} model variable`);
  return { author, family, model, labels: authors };
}

export function eligible(eventName, event, pr, repository, permission) {
  if (pr.state !== "open" || pr.draft || pr.head.repo?.full_name !== repository || pr.user.login === "dependabot[bot]") return false;
  if (event.sender?.type === "Bot") return false;
  if (eventName === "issue_comment") {
    return event.action === "created" && Boolean(event.issue.pull_request) &&
      event.comment.body.trim() === "/review" && ["admin", "maintain", "write"].includes(permission);
  }
  if (eventName !== "pull_request") return false;
  if (["labeled", "unlabeled"].includes(event.action) && !LABELS.includes(event.label?.name)) return false;
  return ["opened", "reopened", "ready_for_review", "synchronize", "labeled", "unlabeled"].includes(event.action) &&
    event.pull_request.head.sha === pr.head.sha;
}

export function sameReviewTarget(pr, initial) {
  return pr.state === "open" && !pr.draft && pr.head.sha === initial.head.sha &&
    pr.base.sha === initial.base.sha && pr.head.repo?.full_name === initial.head.repo?.full_name &&
    JSON.stringify(pr.labels.map((label) => label.name).filter((label) => LABELS.includes(label)).sort()) ===
    JSON.stringify(initial.labels.map((label) => label.name).filter((label) => LABELS.includes(label)).sort());
}

function safe(value, limit = 3000) {
  // Model text is display-only; suppress mentions and HTML/identity markers.
  return String(value ?? "").slice(0, limit).replaceAll("@", "@\u200b").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderReview({ repository, pr, selection, result, failure, runUrl }) {
  const lines = [MARKER, "## AI code review", "", `Commit: \`${pr.head.sha}\``, ""];
  if (selection.reason) return [...lines, selection.reason].join("\n");
  lines.push(`Reviewer: **${safe(selection.model)}** · Author: \`${selection.author}\``, "");
  if (failure) {
    lines.push(`**Review failed:** ${failure}. This is not a clean review.`, "");
  } else {
    const issues = result.review.key_issues_to_review;
    if (issues.length === 0) lines.push("No actionable findings returned. This is not a guarantee of correctness.", "");
    for (const issue of issues.slice(0, 5)) {
      const path = String(issue.relevant_file ?? "");
      const line = Number(issue.start_line);
      const link = path && Number.isInteger(line) && line > 0
        ? `https://github.com/${repository}/blob/${pr.head.sha}/${path.split("/").map(encodeURIComponent).join("/")}#L${line}` : undefined;
      lines.push(`### ${safe(issue.issue_header, 160)}`, "", safe(issue.issue_content), "");
      if (link) lines.push(`[View code](${link})`, "");
    }
    const security = result.review.security_concerns;
    if (security && !["no", "none", "false"].includes(String(security).trim().toLowerCase())) {
      lines.push("### Security", "", safe(security), "");
    }
    for (const [key, label] of [["files_not_reviewed", "Not reviewed"], ["files_partially_reviewed", "Partially reviewed"]]) {
      const files = result.coverage[key];
      if (files.length) lines.push(`**${label}:** ${files.slice(0, 100).map((file) => safe(file, 150)).join(", ")}`, "");
    }
    const usage = result.usage;
    if (Number.isFinite(usage?.total_tokens)) lines.push(`Reported tokens: ${usage.total_tokens}.`, "");
  }
  lines.push(`Advisory AI output; no tests or browser checks were run by this reviewer. [Workflow run](${runUrl}).`);
  return lines.join("\n");
}

export function validateResult(result) {
  if (!result?.review || !Array.isArray(result.review.key_issues_to_review) ||
    !result.review.key_issues_to_review.every((issue) => issue && typeof issue.issue_content === "string" && typeof issue.issue_header === "string") ||
    !Array.isArray(result.coverage?.files_not_reviewed) || !Array.isArray(result.coverage?.files_partially_reviewed)) {
    throw new Error("Malformed structured review");
  }
  return result;
}

export function classifyFailure(log) {
  if (/401|403|authentication|invalid.api.key|unauthorized/i.test(log)) return "authentication or provider authorization error";
  if (/402|insufficient.credit|credit.limit/i.test(log)) return "OpenRouter credit limit or insufficient balance";
  if (/429|rate.limit/i.test(log)) return "provider rate limit";
  if (/timeout|timed.out|ETIMEDOUT/i.test(log)) return "review timeout";
  if (/400|404|model.not.found|unsupported/i.test(log)) return "model or request configuration error";
  return "runtime error or invalid review output";
}

export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { log = (log + chunk).slice(-65536); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, log }));
  });
}

export function reviewEnvironment(selection, env) {
  return {
    OPENROUTER__KEY: env.OPENROUTER_API_KEY,
    OPENROUTER__REASONING_EFFORT: selection.family === "glm" ? "high" : "medium",
    GITHUB__USER_TOKEN: env.GH_TOKEN,
    GITHUB__DEPLOYMENT_TYPE: "user",
    CONFIG__MODEL: `openrouter/${selection.model}`,
    CONFIG__MODEL_WEAK: `openrouter/${selection.model}`,
    CONFIG__MODEL_REASONING: `openrouter/${selection.model}`,
    CONFIG__FALLBACK_MODELS: "[]",
    CONFIG__PUBLISH_OUTPUT: "false",
    CONFIG__USE_REPO_SETTINGS_FILE: "false",
    CONFIG__USE_GLOBAL_SETTINGS_FILE: "false",
    LITELLM_LOCAL_MODEL_COST_MAP: "True",
  };
}

export async function github(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${method} ${path.split("?")[0]}`);
  return response.status === 204 ? undefined : response.json();
}

export async function publish(repository, number, body, api = github) {
  const path = `repos/${repository}/issues/${number}/comments`;
  // Never edit another bot's or a human's comment, even if it contains our marker.
  for (let page = 1; ; page++) {
    const comments = await api(`${path}?per_page=100&page=${page}`);
    const existing = comments.find((comment) => comment.user.login === "github-actions[bot]" && comment.body.startsWith(MARKER));
    if (existing) return api(`repos/${repository}/issues/comments/${existing.id}`, { method: "PATCH", body: { body } });
    if (comments.length < 100) break;
  }
  return api(path, { method: "POST", body: { body } });
}

export async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const number = event.pull_request?.number ?? event.issue?.number;
  if (!number || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid repository or PR event");
  const prPath = `repos/${repository}/pulls/${number}`;
  const pr = await github(prPath);
  let permission;
  if (process.env.GITHUB_EVENT_NAME === "issue_comment") {
    permission = (await github(`repos/${repository}/collaborators/${encodeURIComponent(event.comment.user.login)}/permission`)).permission;
  }
  if (!eligible(process.env.GITHUB_EVENT_NAME, event, pr, repository, permission)) {
    console.log("Review skipped: ineligible event or PR.");
    return;
  }
  const selection = selectReviewer(pr.labels.map((label) => label.name), number, {
    claude: process.env.AI_REVIEW_CLAUDE_MODEL, codex: process.env.AI_REVIEW_GPT_MODEL, glm: process.env.AI_REVIEW_GLM_MODEL,
  });
  const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  let result, failure;
  if (!selection.reason) {
    console.log(`Reviewing ${pr.head.sha} with ${selection.model}`);
    if (!process.env.OPENROUTER_API_KEY) {
      failure = "OPENROUTER_API_KEY repository secret is missing";
    } else {
      const directory = await mkdtemp(`${tmpdir()}/ci-review-`);
      try {
        const config = await readFile(resolve(".pr_agent.toml"), "utf8");
        await writeFile(`${directory}/config.toml`, config);
        const settings = reviewEnvironment(selection, process.env);
        const env = { ...process.env, ...settings };
        const pulled = await run("docker", ["pull", IMAGE]);
        if (pulled.code !== 0) throw new Error("runtime image unavailable");
        if (!sameReviewTarget(await github(prPath), pr)) return;
        const names = Object.keys(settings);
        const outcome = await run("docker", ["run", "--rm", "--mount", `type=bind,source=${directory},target=/review`,
          ...names.flatMap((name) => ["--env", name]), IMAGE,
          "--pr_url", `https://github.com/${repository}/pull/${number}`, "--extra_config_url", "/review/config.toml",
          "--json-output", "/review/result.json", "review"], { env, timeout: 600000 });
        if (outcome.code !== 0) failure = classifyFailure(outcome.log);
        else result = validateResult(JSON.parse(await readFile(`${directory}/result.json`, "utf8")));
      } catch {
        failure = "runtime error or invalid review output";
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
  // PR-Agent reads a live API diff: discard output if head, base, or routing changed.
  if (!sameReviewTarget(await github(prPath), pr)) {
    console.log("Review discarded: the PR changed while inference was running.");
    return;
  }
  const body = renderReview({ repository, pr, selection, result, failure, runUrl });
  await publish(repository, number, body);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, body);
  if (failure) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
