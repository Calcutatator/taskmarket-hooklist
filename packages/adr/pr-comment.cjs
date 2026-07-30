// Renders and posts/updates the ADR embodiment audit PR comment from
// docs/adr-audit/summary.json (written by packages/adr/adr-audit.ts).
//
// Required (not just recommended) as CommonJS (.cjs): actions/github-script
// loads user scripts via require(), which cannot load an ESM (.mjs) module
// synchronously.
//
// Usage from a workflow's actions/github-script step:
//   const prComment = require(`${process.env.GITHUB_WORKSPACE}/packages/adr/pr-comment.cjs`);
//   await prComment({ github, context, workspace: process.env.GITHUB_WORKSPACE });

const fs = require('fs');
const path = require('path');

// Hidden marker at the top of the comment body — used to find this script's
// own prior comment on the PR (if any) and edit it in place, rather than
// posting a brand-new comment on every push.
const MARKER = '<!-- adr-embodiment-audit -->';

// Defensive against a "|" in a stated field corrupting the rendered table — none of the
// current fields can actually contain one (status/embodiment are constrained enum-shaped
// values, not free text), but escaping is cheap and this renders corpus-derived content.
function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function row(adr) {
  const driftMarker = adr.drift ? '⚠️' : '✓';
  return `| ADR-${adr.number} | ${escapeCell(adr.status)} | ${escapeCell(adr.stated)} | ${escapeCell(adr.computed)} | ${driftMarker} | ${adr.specRefs} | ${adr.codeRefs} | ${adr.testRefs} |`;
}

const TABLE_HEADER = ['| ADR | Status | Stated | Computed | Drift? | Specs | Code | Tests |', '|---|---|---|---|---|---|---|---|'];

// Exported separately from the postComment I/O below so the formatting
// itself is testable without a live GitHub API / Octokit client.
function renderBody(summary) {
  const adrs = summary.adrs;
  const drifts = adrs.filter((a) => a.drift);

  const lines = [MARKER, `### ADR Embodiment Audit — ${summary.generated}`, '', `${adrs.length} ADR(s) checked, ${drifts.length} drift alert(s).`, ''];

  if (drifts.length > 0) {
    lines.push(
      "**Drifting ADRs** (stated `Embodiment` doesn't match what the reconciliation script computed from spec/code/test back-references):",
      '',
      ...TABLE_HEADER,
      ...drifts.map(row),
      ''
    );
  } else {
    lines.push("✓ No drift — every ADR's stated `Embodiment` matches what the script computed.", '');
  }

  lines.push(
    '<details>',
    `<summary>Full audit table (${adrs.length} ADRs)</summary>`,
    '',
    ...TABLE_HEADER,
    ...adrs.map(row),
    '',
    '</details>',
    '',
    '_Warn-only — see `docs/adr-audit/report.md` in workflow artifacts for per-ADR detail._'
  );

  return lines.join('\n');
}

async function postComment({ github, context, workspace }) {
  const summaryPath = path.join(workspace, 'docs/adr-audit/summary.json');
  if (!fs.existsSync(summaryPath)) return;

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const body = renderBody(summary);

  const comments = await github.paginate(github.rest.issues.listComments, {
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });
  const existing = comments.find((c) => c.body && c.body.startsWith(MARKER));

  if (existing) {
    await github.rest.issues.updateComment({
      comment_id: existing.id,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body,
    });
  }
}

module.exports = postComment;
module.exports.renderBody = renderBody;
module.exports.MARKER = MARKER;
