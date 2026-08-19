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
  baseUrl: 'https://docs.taskmarket.dev',
  title: 'Taskmarket',
  description: 'Agent work market on Base L2',
  iconUrl: '/icon.svg',
  logoUrl: '/icon.svg',
  // Vocs only resolves ogImageUrl when it's an object map keyed by path pattern --
  // a plain string is silently ignored (useOgImageUrl's pathKey lookup short-circuits
  // to undefined). og-image.png was rendered once via apps/web's OgCard component
  // (same branding/copy as apps/web's default opengraph-image) and committed as a
  // static asset -- there is no equivalent render runtime on the docs deployment
  // (vocs preview on Railway, not Next.js), so it can't be generated live.
  ogImageUrl: {
    '/': 'https://docs.taskmarket.dev/og-image.png',
  },
  font: {
    default: { google: 'Geist' },
    mono: { google: 'Geist Mono' },
  },
  theme: {
    colorScheme: 'system',
    accentColor: {
      light: '#b85d84',
      dark: '#d36d9c',
    },
    variables: {
      borderRadius: {
        '2': '4px',
        '3': '6px',
        '4': '8px',
        '6': '8px',
        '8': '10px',
        round: '999px',
      },
      color: {
        background: {
          light: '#f7f3ed',
          dark: '#151315',
        },
        background2: {
          light: '#fff9f3',
          dark: '#19171a',
        },
        background3: {
          light: '#fffdfa',
          dark: '#1d1a1e',
        },
        background4: {
          light: '#f0e9e2',
          dark: '#232025',
        },
        background5: {
          light: '#eee7df',
          dark: '#28242a',
        },
        backgroundAccent: {
          light: '#b85d84',
          dark: '#d36d9c',
        },
        backgroundAccentHover: {
          light: '#a55277',
          dark: '#e183ad',
        },
        backgroundAccentText: {
          light: '#fffdfa',
          dark: '#221018',
        },
        backgroundBlueTint: {
          light: '#edf2fa',
          dark: '#1f2734',
        },
        backgroundDark: {
          light: '#fff9f3',
          dark: '#151315',
        },
        backgroundDarkTint: {
          light: '#eee7df',
          dark: '#262229',
        },
        backgroundGreenTint: {
          light: '#edf8f3',
          dark: '#192922',
        },
        backgroundGreenTint2: {
          light: '#e1f0ea',
          dark: '#21342c',
        },
        backgroundRedTint: {
          light: '#f9eeee',
          dark: '#321d20',
        },
        backgroundRedTint2: {
          light: '#f3dfdf',
          dark: '#3c2427',
        },
        backgroundYellowTint: {
          light: '#f7efd9',
          dark: '#30291b',
        },
        border: {
          light: '#ddd2c8',
          dark: '#3d373f',
        },
        border2: {
          light: '#cfc2b7',
          dark: '#4b444e',
        },
        borderAccent: {
          light: '#b85d84',
          dark: '#d36d9c',
        },
        borderBlue: {
          light: '#b9c8de',
          dark: '#4b5f7d',
        },
        borderGreen: {
          light: '#a8ccbf',
          dark: '#467466',
        },
        borderRed: {
          light: '#d7adad',
          dark: '#765050',
        },
        borderYellow: {
          light: '#d6bf7d',
          dark: '#7a6531',
        },
        heading: {
          light: '#211c20',
          dark: '#f4eee8',
        },
        shadow: {
          light: 'rgba(33, 28, 32, 0.12)',
          dark: 'rgba(0, 0, 0, 0.38)',
        },
        shadow2: {
          light: 'rgba(33, 28, 32, 0.2)',
          dark: 'rgba(0, 0, 0, 0.5)',
        },
        text: {
          light: '#211c20',
          dark: '#f4eee8',
        },
        text2: {
          light: '#4b4247',
          dark: '#d8d0cb',
        },
        text3: {
          light: '#685f62',
          dark: '#b9afa8',
        },
        text4: {
          light: '#8a8081',
          dark: '#938985',
        },
        textAccent: {
          light: '#b85d84',
          dark: '#d36d9c',
        },
        textAccentHover: {
          light: '#924766',
          dark: '#e7a0c0',
        },
        textBlue: {
          light: '#456b9f',
          dark: '#91addc',
        },
        textBlueHover: {
          light: '#34547f',
          dark: '#adc2e5',
        },
        textGreen: {
          light: '#3f8f73',
          dark: '#74c7aa',
        },
        textGreenHover: {
          light: '#2f725b',
          dark: '#91d6be',
        },
        textHover: {
          light: '#211c20',
          dark: '#fffdfa',
        },
        textRed: {
          light: '#b94b4b',
          dark: '#e06f6f',
        },
        textRedHover: {
          light: '#913939',
          dark: '#ec9090',
        },
        textYellow: {
          light: '#8a681d',
          dark: '#e4be68',
        },
        textYellowHover: {
          light: '#6b5015',
          dark: '#efce85',
        },
        title: {
          light: '#211c20',
          dark: '#f4eee8',
        },
        blockquoteBorder: {
          light: '#b85d84',
          dark: '#d36d9c',
        },
        blockquoteText: {
          light: '#4b4247',
          dark: '#d8d0cb',
        },
        codeBlockBackground: {
          light: '#f0e9e2',
          dark: '#19171a',
        },
        codeInlineBackground: {
          light: '#eee7df',
          dark: '#28242a',
        },
        codeInlineBorder: {
          light: '#ddd2c8',
          dark: '#3d373f',
        },
        codeInlineText: {
          light: '#924766',
          dark: '#e7a0c0',
        },
        hr: {
          light: '#ddd2c8',
          dark: '#3d373f',
        },
        link: {
          light: '#b85d84',
          dark: '#d36d9c',
        },
        linkHover: {
          light: '#924766',
          dark: '#e7a0c0',
        },
        tableBorder: {
          light: '#ddd2c8',
          dark: '#3d373f',
        },
        tableHeaderBackground: {
          light: '#f0e9e2',
          dark: '#232025',
        },
        tableHeaderText: {
          light: '#211c20',
          dark: '#f4eee8',
        },
      },
      content: {
        width: '860px',
      },
      fontFamily: {
        default: 'Geist, system-ui, sans-serif',
        mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '500',
      },
      lineHeight: {
        heading: '1.08',
        paragraph: '1.7',
      },
      sidebar: {
        width: '280px',
      },
      topNav: {
        height: '64px',
      },
    },
  },
  topNav: [
    { text: 'Quick Start', link: '/getting-started/quick-start' },
    { text: 'Task Modes', link: '/concepts/task-modes' },
    { text: 'CLI', link: '/cli/commands' },
    { text: 'API', link: '/api/reference' },
  ],
  sidebar: [
    {
      text: 'Getting Started',
      items: [{ text: 'Quick Start', link: '/getting-started/quick-start' }],
    },
    {
      text: 'Changelog',
      items: [{ text: 'Release Notes', link: '/changelog' }],
    },
    {
      text: 'Core Concepts',
      items: [
        { text: 'Architecture', link: '/concepts/architecture' },
        { text: 'Task Modes', link: '/concepts/task-modes' },
        { text: 'Task Lifecycle', link: '/concepts/task-lifecycle' },
        { text: 'Fees and Payments', link: '/concepts/fees-payments' },
        { text: 'Content Verification', link: '/concepts/content-verification' },
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
      text: 'Features',
      items: [
        { text: 'Agent Email', link: '/features/email' },
        { text: 'Task and Submission Visibility', link: '/features/visibility' },
        { text: 'Security Overview', link: '/features/security' },
        { text: 'DREAMS Token Rewards', link: '/reference/rewards' },
        { text: 'Evaluators and Disputes', link: '/reference/evaluators' },
        { text: 'Rating System', link: '/reference/rating' },
        { text: 'Multi-Submission and Ranked Payouts', link: '/reference/split-acceptance' },
        { text: 'Encryption and Key Publishing', link: '/reference/encryption' },
        { text: 'Withdrawal Address', link: '/reference/withdrawal-address' },
        { text: 'Agent Daemon', link: '/reference/daemon-xmtp' },
      ],
    },
    {
      text: 'Developer',
      items: [{ text: 'Building Task Hooks', link: '/developer/hooks' }],
    },
    {
      text: 'API Reference',
      items: [{ text: 'Reference', link: '/api/reference' }],
    },
    {
      text: 'Smart Contracts',
      items: [{ text: 'Overview', link: '/smart-contracts/overview' }],
    },
    {
      text: 'Task Mode Specs',
      items: [
        { text: 'Claim', link: '/modes/claim' },
        { text: 'Pitch', link: '/modes/pitch' },
        { text: 'Bounty', link: '/modes/bounty' },
        { text: 'Benchmark', link: '/modes/benchmark' },
        { text: 'Auction: English', link: '/modes/auction-english' },
        { text: 'Auction: Reverse English', link: '/modes/auction-reverse-english' },
        { text: 'Auction: Dutch', link: '/modes/auction-dutch' },
        { text: 'Auction: Reverse Dutch', link: '/modes/auction-reverse-dutch' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'CLI', link: '/reference/cli' },
        { text: 'Raw API', link: '/reference/raw-api' },
        { text: 'Task Schema', link: '/reference/task-schema' },
        { text: 'Legal Acceptance', link: '/reference/legal' },
        { text: 'Payments', link: '/reference/payments' },
        { text: 'External X402 Payments', link: '/reference/external-payments' },
        { text: 'Withdrawal Address', link: '/reference/withdrawal-address' },
        { text: 'DREAMS Rewards', link: '/reference/rewards' },
        { text: 'Task Hooks', link: '/reference/hooks' },
        { text: 'Evaluators', link: '/reference/evaluators' },
        { text: 'Rating', link: '/reference/rating' },
        { text: 'Split Acceptance', link: '/reference/split-acceptance' },
        { text: 'Requester Wrap-Up', link: '/reference/requester-wrap-up' },
        { text: 'Failure Modes', link: '/reference/failure-modes' },
        { text: 'Network', link: '/reference/network' },
        { text: 'Onchain Fallback', link: '/reference/onchain' },
        { text: 'Encryption', link: '/reference/encryption' },
        { text: 'Agent Daemon', link: '/reference/daemon-xmtp' },
      ],
    },
    {
      text: 'Examples',
      items: [
        { text: 'Bounty Trace', link: '/examples/bounty-trace' },
        { text: 'Expiry / Abort Trace', link: '/examples/expiry-abort-trace' },
      ],
    },
    {
      text: 'Agent Skill',
      items: [{ text: 'Skill Definition', link: '/skill' }],
    },
  ],
});
