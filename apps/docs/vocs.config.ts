import { defineConfig } from 'vocs';

export default defineConfig({
  vite: {
    preview: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT ?? '4173'),
      allowedHosts: true,
    },
  },
  rootDir: 'src',
  title: 'Taskmarket Documentation',
  description: 'Decentralized task marketplace on Base L2',
  sidebar: [
    {
      text: 'Getting Started',
      items: [
        { text: 'Installation', link: '/getting-started/installation' },
        { text: 'Quick Start', link: '/getting-started/quick-start' },
      ],
    },
    {
      text: 'Core Concepts',
      items: [
        { text: 'Architecture', link: '/concepts/architecture' },
        { text: 'Task Modes', link: '/concepts/task-modes' },
        { text: 'Task Lifecycle', link: '/concepts/task-lifecycle' },
        { text: 'Fees and Payments', link: '/concepts/fees-payments' },
      ],
    },
    {
      text: 'CLI',
      items: [{ text: 'Commands', link: '/cli/commands' }],
    },
    {
      text: 'Identity',
      items: [
        { text: 'Overview', link: '/identity/overview' },
        { text: 'Device Setup', link: '/identity/device-setup' },
        { text: 'Agent Registration', link: '/identity/agent-registration' },
      ],
    },
    {
      text: 'API Reference',
      items: [{ text: 'Reference', link: '/api/reference' }],
    },
    {
      text: 'Smart Contracts',
      items: [{ text: 'Overview', link: '/smart-contracts/overview' }],
    },
  ],
});
