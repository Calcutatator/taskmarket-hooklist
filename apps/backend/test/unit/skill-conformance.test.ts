import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AuctionType,
  PAID_PENDING_ACTION_NAMES,
  PendingActionName,
  STANDARD_X402_ACTION_AMOUNT,
  TaskMode,
  TaskStatus,
  USDC_DECIMALS,
  buildSelectWorkerMessage,
} from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_REGISTER_ROUTE,
  PAID_TASK_ACTION_ROUTES,
  TASK_CREATE_ROUTE,
} from '../../src/config/payments';
import { expressPathToDocumentedApiPath } from '../../src/config/routes';
import {
  computePendingActions,
  computeSubmissionWindowOpen,
  type PendingActionTask,
} from '../../src/lib/task';
import { generateOpenAPI } from '../../src/lib/openapi';

const repositoryRoot = path.resolve(process.cwd(), '../..');
const skillRoot = path.join(repositoryRoot, 'apps/docs/src/public');
const openApiMethods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

function readSkillFile(relativePath: string): string {
  return readFileSync(path.join(skillRoot, relativePath), 'utf8');
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`Missing section: ${heading}`);
  const contentStart = start + heading.length + 3;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return markdown.slice(contentStart, nextHeading === -1 ? undefined : nextHeading);
}

function tableRows(markdownSection: string): string[][] {
  return markdownSection
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .slice(1)
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
    );
}

function backtickValues(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function skillMarkdownFiles(): string[] {
  return readSkillFile('reference/skill-manifest.txt')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'));
}

function allSkillMarkdown(): string {
  return skillMarkdownFiles().map(readSkillFile).join('\n');
}

function pendingActionTask(
  overrides: Partial<PendingActionTask>,
  expiryTime: Date
): PendingActionTask {
  return {
    id: `0x${'ab'.repeat(32)}`,
    requester: '0x0000000000000000000000000000000000000001',
    status: 'open',
    mode: 'bounty',
    rating: null,
    pitchCount: 0,
    bidCount: 0,
    submissionCount: 0,
    expiryTime,
    pitchDeadline: null,
    bidDeadline: null,
    claimedBy: null,
    worker: null,
    auctionType: null,
    currentClockPrice: null,
    currentLowestBid: null,
    ...overrides,
  };
}

function documentedPendingAction(file: string): { action: string; role: string } {
  const serialized = readSkillFile(file).match(/pendingActions[^\n]*contains `(\{[^`]+\})`/)?.[1];
  if (!serialized) throw new Error(`Missing exact pending action in ${file}`);
  return JSON.parse(serialized) as { action: string; role: string };
}

describe('shipped skill platform conformance', () => {
  it('runs as a dedicated GitHub Actions job', () => {
    const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    const job = workflow.match(
      /\n  skill-conformance:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|$)/
    )?.[0];
    expect(job).toBeDefined();
    expect(job).toContain('run: make skill-conformance');
  });

  it('documents the exact runtime modes, statuses, and pending actions', () => {
    const root = readSkillFile('skill.md');
    const taskSchema = readSkillFile('reference/task-schema.md');

    const documentedStatuses = section(root, 'Statuses')
      .match(/```text\n([\s\S]*?)\n```/)?.[1]
      .split('\n');
    expect(documentedStatuses).toEqual(TaskStatus.options);

    const actionParagraph = section(taskSchema, 'pendingActions')
      .split('\n')
      .find((line) => line.startsWith('Valid action values are'));
    expect(backtickValues(actionParagraph ?? '')).toEqual(PendingActionName.options);

    const modeCells = tableRows(section(root, 'Mode Router')).map(([mode]) =>
      backtickValues(mode)
    );
    expect([...new Set(modeCells.map(([mode]) => mode))].sort()).toEqual(
      [...TaskMode.options].sort()
    );
    expect(
      modeCells
        .filter(([mode]) => mode === 'auction')
        .map(([, auctionType]) => auctionType)
        .sort()
    ).toEqual([...AuctionType.options].sort());
  });

  it('documents submission windows exactly as the backend computes them', () => {
    const taskSchema = readSkillFile('reference/task-schema.md');
    const documentedStates = Object.fromEntries(
      tableRows(section(taskSchema, 'submissionWindowOpen')).map(([mode, state]) => [
        mode.toLowerCase(),
        backtickValues(state)[0],
      ])
    );
    const now = new Date('2026-07-12T00:00:00.000Z');
    const expiryTime = new Date('2026-07-13T00:00:00.000Z');

    expect(Object.keys(documentedStates).sort()).toEqual([...TaskMode.options].sort());
    for (const mode of TaskMode.options) {
      for (const status of TaskStatus.options) {
        expect(
          computeSubmissionWindowOpen({ mode, status, expiryTime }, now),
          `${mode}/${status}`
        ).toBe(documentedStates[mode] === status);
      }
    }
  });

  it('documents exact mode entry actions generated by the backend', () => {
    const now = new Date('2026-07-12T00:00:00.000Z');
    const expiryTime = new Date('2026-07-13T00:00:00.000Z');
    const cases = [
      ['modes/bounty.md', { mode: 'bounty' }],
      ['modes/claim.md', { mode: 'claim' }],
      ['modes/pitch.md', { mode: 'pitch', pitchDeadline: expiryTime }],
      ['modes/benchmark.md', { mode: 'benchmark' }],
      [
        'modes/auction-dutch.md',
        { mode: 'auction', auctionType: 'dutch', bidDeadline: expiryTime },
      ],
      [
        'modes/auction-reverse-dutch.md',
        { mode: 'auction', auctionType: 'reverse_dutch', bidDeadline: expiryTime },
      ],
      [
        'modes/auction-english.md',
        { mode: 'auction', auctionType: 'english', bidDeadline: expiryTime },
      ],
      [
        'modes/auction-reverse-english.md',
        { mode: 'auction', auctionType: 'reverse_english', bidDeadline: expiryTime },
      ],
    ] as const;

    for (const [file, overrides] of cases) {
      const runtimeActions = computePendingActions(
        pendingActionTask(overrides, expiryTime),
        now
      );
      expect(runtimeActions, file).toContainEqual(
        expect.objectContaining(documentedPendingAction(file))
      );
    }
  });

  it('documents the shared X402 fee and every paid pending action', () => {
    const payments = readSkillFile('reference/payments.md');
    const root = readSkillFile('skill.md');
    const standardFee = Number(STANDARD_X402_ACTION_AMOUNT) / 10 ** USDC_DECIMALS;
    const standardFeeText = `${standardFee} USDC`;

    expect(payments).toContain(`${standardFeeText} = ${STANDARD_X402_ACTION_AMOUNT} base units`);
    expect(root).toContain(
      `\`${STANDARD_X402_ACTION_AMOUNT}\` is ${standardFeeText}.`
    );

    expect(Object.keys(PAID_TASK_ACTION_ROUTES).sort()).toEqual(
      [...PAID_PENDING_ACTION_NAMES].sort()
    );
    const documentedPaidRoutes = tableRows(section(payments, 'Paid Routes')).map(
      ([route]) => backtickValues(route)[0]
    );
    const runtimePaidRoutes = [
      TASK_CREATE_ROUTE,
      ...Object.values(PAID_TASK_ACTION_ROUTES),
      IDENTITY_REGISTER_ROUTE,
    ].map((route) => `POST ${expressPathToDocumentedApiPath(route)}`);
    expect(documentedPaidRoutes.sort()).toEqual(runtimePaidRoutes.sort());

    const divergentFeeClaims = allSkillMarkdown()
      .split('\n')
      .filter((line) => /(?:cost|fee|charge)[^\n]*\b\d+(?:\.\d+)? USDC/i.test(line))
      .filter((line) => !line.includes(standardFeeText));
    expect(divergentFeeClaims).toEqual([]);
  });

  it('documents the canonical pitch-selection signature message', () => {
    const rawApi = readSkillFile('reference/raw-api.md');
    const template = rawApi.match(
      /taskmarket:select-worker:<taskId>:<pitchId>:<lowercaseWorkerAddress>/
    )?.[0];
    expect(template).toBeDefined();

    const rendered = template
      ?.replace('<taskId>', '0xabc')
      .replace('<pitchId>', 'pitch-1')
      .replace('<lowercaseWorkerAddress>', '0xdef');
    expect(rendered).toBe(buildSelectWorkerMessage('0xabc', 'pitch-1', '0xDeF'));
  });

  it('rejects known stale user-facing skill claims', () => {
    const displayedInstaller = readFileSync(
      path.join(repositoryRoot, 'apps/web/lib/skill.ts'),
      'utf8'
    );
    const content = `${allSkillMarkdown()}\n${displayedInstaller}`;
    const staleClaims = [
      [
        'public accepted status',
        /(?:["']?status["']?\s*[:=]\s*["'`]accepted|status\s+is\s+`?accepted|\|\s*`?accepted`?\s*\|)/i,
      ],
      ['old standard action fee', /\b0\.01 USDC\b/i],
      ['ignored rater identity', /\braterAgentId\b|--rater-agent-id\b/],
      ['one-file skill install', /curl[^\n]*\/skill\.md[^\n]*(?:\s-o\s|>)/i],
      ['ambiguous pending action', /pendingActions[^\n]*(?:action such as|or equivalent entry)/i],
    ] as const;

    for (const [label, pattern] of staleClaims) {
      expect(content.match(pattern), label).toBeNull();
    }
    expect(displayedInstaller).toContain('/install-skill.sh');
  });

  it('references only routes present in generated OpenAPI', () => {
    const document = generateOpenAPI();
    const documentedRoutes = new Set<string>();
    const missingRoutes: string[] = [];

    for (const file of skillMarkdownFiles()) {
      for (const match of readSkillFile(file).matchAll(
        /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE) (\/api\/[^\s`|]+)/g
      )) {
        const method = match[1].toLowerCase() as (typeof openApiMethods)[number];
        const documentedPath = match[2].replace(/[).,;:]$/, '').split('?')[0];
        const openApiPath = documentedPath
          .slice('/api'.length)
          .replace(/<([a-zA-Z][a-zA-Z0-9]*)>/g, '{$1}');
        documentedRoutes.add(`${method.toUpperCase()} ${openApiPath}`);
        if (!document.paths?.[openApiPath]?.[method]) {
          missingRoutes.push(`${file}: ${match[1]} ${documentedPath}`);
        }
      }
    }

    expect(missingRoutes).toEqual([]);

    const undocumentedRoutes: string[] = [];
    for (const [openApiPath, pathItem] of Object.entries(document.paths ?? {})) {
      for (const method of openApiMethods) {
        const operation = pathItem?.[method];
        if (
          operation?.tags?.some((tag) => tag === 'Tasks' || tag === 'Evaluations') &&
          !documentedRoutes.has(`${method.toUpperCase()} ${openApiPath}`)
        ) {
          undocumentedRoutes.push(`${method.toUpperCase()} /api${openApiPath}`);
        }
      }
    }
    expect(undocumentedRoutes.sort()).toEqual([]);
  });
});
