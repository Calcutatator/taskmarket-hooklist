export const COMMAND_NAMES = [
  'docs',
  'drop',
  'report',
  'status',
  'task',
  'task-drops',
  'tasks',
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export function isCommandName(value: string): value is CommandName {
  return COMMAND_NAMES.some((commandName) => commandName === value);
}

export interface DiscordCommandDefinition {
  contexts: [0];
  description: string;
  integration_types: [0];
  name: CommandName;
  options?: Array<{
    description: string;
    max_length: number;
    min_length: number;
    name: string;
    required: true;
    type: 3;
  }>;
  type: 1;
}

const command = (
  definition: Omit<DiscordCommandDefinition, 'contexts' | 'integration_types' | 'type'>
): DiscordCommandDefinition => ({
  ...definition,
  contexts: [0],
  integration_types: [0],
  type: 1,
});

export function buildCommandManifest(options: {
  includeStatus: boolean;
}): DiscordCommandDefinition[] {
  return [
    command({
      description: 'Show a public Taskmarket task',
      name: 'task',
      options: [
        {
          description: 'Taskmarket task ID',
          max_length: 128,
          min_length: 1,
          name: 'task_id',
          required: true,
          type: 3,
        },
      ],
    }),
    command({ description: 'List the 10 highest-paying open tasks', name: 'tasks' }),
    command({
      description: 'Show a public Task Drop',
      name: 'drop',
      options: [
        {
          description: 'Taskmarket Task Drop ID',
          max_length: 128,
          min_length: 1,
          name: 'drop_id',
          required: true,
          type: 3,
        },
      ],
    }),
    command({ description: 'List Task Drops with open work', name: 'task-drops' }),
    command({ description: 'Open Taskmarket documentation', name: 'docs' }),
    command({ description: 'Report a bug or safety issue privately', name: 'report' }),
    ...(options.includeStatus
      ? [command({ description: 'Open Taskmarket service status', name: 'status' })]
      : []),
  ];
}

export function commandNames(
  commands: readonly DiscordCommandDefinition[]
): DiscordCommandDefinition['name'][] {
  return commands.map((commandDefinition) => commandDefinition.name);
}
