// Emails a summary of the weekly production smoke run via Resend.
//
// Run from `.github/workflows/smoke.yml` after the smoke suite, on both pass and
// fail (`if: !cancelled()`), so the atelier gets a weekly report either way — a
// green "all clear" is as useful as a red alarm for a synthetic monitor. The
// failure-only GitHub issue in the workflow is unchanged; this is additive.
//
// Reuses the app's Resend setup (same key + verified sender the app emails
// through) — no new vendor. It mirrors the app's best-effort mail philosophy:
// a missing key or a Resend hiccup is logged and swallowed, and this script
// NEVER exits non-zero, so a mail problem can't turn a green run red (or mask a
// red one). The test step's own exit code already carries the pass/fail verdict.
//
// Inputs (all from the environment):
//   RESEND_API_KEY      required to send; unset ⇒ skip (logged), exit 0
//   RESEND_FROM_EMAIL   verified sender, e.g. "A.A Atelier <orders@a3iceanddance.com>"
//   SMOKE_REPORT_TO     recipient (defaults to the atelier inbox)
//   PLAYWRIGHT_BASE_URL the smoke target, for the report header
//   GITHUB_SERVER_URL / GITHUB_REPOSITORY / GITHUB_RUN_ID  build the run link
//   SMOKE_JOB_STATUS    the workflow job status ("success"/"failure"), used as a
//                       fallback verdict when the JSON report is missing

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_TO = "alexandra@a3iceanddance.com";
const REPORT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "smoke-report",
  "results.json",
);

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Flatten Playwright's nested suite tree into a flat list of specs. */
function collectSpecs(suite, out) {
  for (const spec of suite.specs ?? []) {
    const status = spec.tests?.[0]?.results?.at(-1)?.status ?? "unknown";
    out.push({
      title: spec.title,
      file: spec.file,
      ok: spec.ok === true,
      status,
    });
  }
  for (const child of suite.suites ?? []) collectSpecs(child, out);
  return out;
}

/** Parse the JSON reporter output into a { stats, specs } summary, or null. */
async function loadReport() {
  let raw;
  try {
    raw = await readFile(REPORT_PATH, "utf8");
  } catch {
    return null; // report missing (e.g. the runner crashed before writing it)
  }
  try {
    const report = JSON.parse(raw);
    const specs = [];
    for (const suite of report.suites ?? []) collectSpecs(suite, specs);
    const stats = report.stats ?? {};
    return {
      passed: stats.expected ?? 0,
      failed: stats.unexpected ?? 0,
      flaky: stats.flaky ?? 0,
      skipped: stats.skipped ?? 0,
      durationMs: stats.duration ?? 0,
      specs,
    };
  } catch {
    return null; // malformed report — fall back to the job-status email
  }
}

function runUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  }
  return null;
}

function buildEmail(report) {
  const target = process.env.PLAYWRIGHT_BASE_URL || "production";
  const when = new Date().toISOString();
  const link = runUrl();

  // No parseable report ⇒ lean on the job status the workflow passed in.
  if (!report) {
    const failed = process.env.SMOKE_JOB_STATUS !== "success";
    const subject = failed
      ? "⚠️ Weekly smoke tests — report unavailable (job failed)"
      : "⚠️ Weekly smoke tests — report unavailable";
    const lines = [
      `The weekly smoke run finished but no machine-readable report was produced.`,
      `Job status: ${process.env.SMOKE_JOB_STATUS || "unknown"}.`,
      `Target: ${target}`,
      link ? `Run: ${link}` : null,
      `Time: ${when}`,
    ].filter(Boolean);
    return {
      subject,
      text: lines.join("\n"),
      html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${lines
        .map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`)
        .join("")}</div>`,
    };
  }

  const { passed, failed, flaky, skipped, durationMs, specs } = report;
  const total = passed + failed;
  const ok = failed === 0;
  const seconds = (durationMs / 1000).toFixed(1);
  const subject = ok
    ? `✅ Weekly smoke tests passed (${passed}/${total})`
    : `❌ Weekly smoke tests FAILED (${failed} of ${total})`;

  const statusEmoji = (s) =>
    s === "passed" ? "✅" : s === "skipped" ? "⏭️" : "❌";

  const rows = specs
    // Failures first, then the rest, so the important lines are up top.
    .slice()
    .sort((a, b) => Number(a.ok) - Number(b.ok))
    .map(
      (s) =>
        `<tr><td style="padding:4px 10px 4px 0">${statusEmoji(
          s.status,
        )}</td><td style="padding:4px 10px 4px 0"><strong>${esc(
          s.title,
        )}</strong></td><td style="padding:4px 0;color:#666">${esc(
          s.file,
        )}</td></tr>`,
    )
    .join("");

  const textRows = specs
    .slice()
    .sort((a, b) => Number(a.ok) - Number(b.ok))
    .map((s) => `  ${statusEmoji(s.status)} ${s.title} (${s.file})`)
    .join("\n");

  const summaryLine =
    `Passed ${passed} · Failed ${failed} · Flaky ${flaky} · Skipped ${skipped}` +
    ` · ${seconds}s`;

  const text = [
    ok
      ? `All ${total} production smoke tests passed.`
      : `${failed} of ${total} production smoke tests FAILED.`,
    ``,
    summaryLine,
    `Target: ${target}`,
    link ? `Run: ${link}` : null,
    `Time: ${when}`,
    ``,
    `Results:`,
    textRows,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#111">
      <h2 style="margin:0 0 4px;font-size:18px">
        ${ok ? "✅" : "❌"} Weekly production smoke tests
      </h2>
      <p style="margin:0 0 12px;color:#444">
        ${ok ? `All ${total} tests passed.` : `<strong>${failed} of ${total} tests failed.</strong>`}
      </p>
      <p style="margin:0 0 12px;padding:8px 12px;background:#f5f5f4;border-radius:6px;color:#333">
        ${esc(summaryLine)}
      </p>
      <table style="border-collapse:collapse;margin:0 0 16px;font-size:13px">${rows}</table>
      <p style="margin:0;color:#666;font-size:12px">
        Target: <code>${esc(target)}</code><br/>
        ${link ? `Run: <a href="${esc(link)}">${esc(link)}</a><br/>` : ""}
        ${esc(when)}
      </p>
    </div>`;

  return { subject, text, html };
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.SMOKE_REPORT_TO || DEFAULT_TO;

  // Self-gate exactly like the app's mailer: no config ⇒ nothing to send.
  if (!apiKey || !from) {
    console.warn(
      "[smoke-report] Skipping email — RESEND_API_KEY and/or RESEND_FROM_EMAIL " +
        "are not set. (The GitHub Actions run still records the pass/fail result.)",
    );
    return;
  }

  const report = await loadReport();
  const { subject, text, html } = buildEmail(report);

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[smoke-report] Resend rejected the report email (status ${response.status}): ${body}`,
      );
      return;
    }
    console.log(`[smoke-report] Report emailed to ${to}: "${subject}"`);
  } catch (err) {
    console.warn(`[smoke-report] Failed to send report email: ${err}`);
  }
}

// Best-effort: never let a mail problem fail the workflow (or mask the test
// verdict the test step already set). Always exit 0.
await main();
