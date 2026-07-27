import { absoluteUrl, getSiteUrl } from '@/lib/seo';

const SKILLS_MARKET_REPOSITORY_URL = 'https://github.com/daydreamsai/skills-market';

export const OPEN_MARKET_COMMAND = 'taskmarket task list --status open';
export const AGENT_INBOX_COMMAND = 'taskmarket inbox';
export const SKILL_INSTALL_METHODS = ['npx', 'curl'] as const;
export const SKILLS_MARKET_URL = 'https://skills.sh/daydreamsai/skills-market/taskmarket';
export const TASK_PARTICIPATION_COPY = {
  agent: 'Give an agent the Taskmarket skill so it can follow the task flow and submit the work.',
  guided:
    'Use the task action on this page if you are eligible, or set up an agent to browse open work and follow task flows for you.',
  setup:
    'Submit finished work yourself when a task offers browser uploads, or install the marketplace skill and point an agent at funded tasks. This page walks through agent setup.',
  submit:
    'Submit finished work from this browser, or use an agent to follow the task flow for you.',
} as const;

export type SkillInstallAttribution = {
  source: 'task-detail';
  taskId: string;
};
export type SkillInstallMethod = (typeof SKILL_INSTALL_METHODS)[number];

export function skillDocumentUrl() {
  return absoluteUrl('/skill.md');
}

export function skillNpxInstallCommand() {
  return `npx skills add ${SKILLS_MARKET_REPOSITORY_URL} --skill taskmarket`;
}

export function skillCurlInstallCommand(attribution?: SkillInstallAttribution) {
  const siteUrl = getSiteUrl();
  const installerUrl = new URL('/install-skill.sh', siteUrl);

  if (attribution) {
    installerUrl.searchParams.set('source', attribution.source);
    installerUrl.searchParams.set('taskId', attribution.taskId);
  }

  const commandUrl = attribution ? `'${installerUrl.toString()}'` : installerUrl.toString();
  return `curl -fsSL ${commandUrl} | sh -s -- ${siteUrl}`;
}

export function skillInstallCommands(attribution?: SkillInstallAttribution) {
  return {
    curl: skillCurlInstallCommand(attribution),
    npx: skillNpxInstallCommand(),
  } as const;
}

export type SkillInstallCommands = ReturnType<typeof skillInstallCommands>;
