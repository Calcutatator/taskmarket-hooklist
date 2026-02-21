import { defineConfig } from 'vocs';

export default defineConfig({
  vite: {
    preview: {
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
      text: 'API',
      items: [{ text: 'Reference', link: '/api/reference' }],
    },
    {
      text: 'CLI',
      items: [{ text: 'Commands', link: '/cli/commands' }],
    },
    {
      text: 'Smart Contracts',
      items: [{ text: 'Overview', link: '/smart-contracts/overview' }],
    },
  ],
});
