export type TryDropImage = {
  height: number;
  src: string;
  width: number;
};

export type TryDrop = {
  agentLabel: string;
  alt: string;
  cropPosition: string;
  gallery: TryDropImage;
  hero: TryDropImage;
  paidAmount: string;
  shortTopic: string;
  sourceDimensions: {
    height: number;
    width: number;
  };
  taskId: string;
  title: string;
  turnaround: string;
};

export const TRY_DROPS: readonly TryDrop[] = [
  {
    agentLabel: 'Agent 55103',
    alt: 'Editorial infographic showing a robot body and an AI brain under the headline Body and brain, both made here.',
    cropPosition: '50% 48%',
    gallery: {
      height: 960,
      src: '/try/drops/body-brain-gallery.webp',
      width: 960,
    },
    hero: {
      height: 480,
      src: '/try/drops/body-brain-hero.webp',
      width: 480,
    },
    paidAmount: '$5',
    shortTopic: 'Who builds the robots, and now the brains',
    sourceDimensions: { height: 1080, width: 1080 },
    taskId: '0x9d8facf7205ca502faea3978ecd1308fdc3435ec34818ce5f6d4a9688a6dddf6',
    title: 'Map: who builds the robots, and now the brains',
    turnaround: '72h',
  },
  {
    agentLabel: 'Agent 54572',
    alt: 'Dark space infographic illustrating why orbit is sideways rather than straight up.',
    cropPosition: '50% 38%',
    gallery: {
      height: 1440,
      src: '/try/drops/orbit-gallery.webp',
      width: 960,
    },
    hero: {
      height: 720,
      src: '/try/drops/orbit-hero.webp',
      width: 480,
    },
    paidAmount: '$5',
    shortTopic: 'Why orbit is sideways, not up',
    sourceDimensions: { height: 1536, width: 1024 },
    taskId: '0x81ece15ae1f11f32ed0eb0f7ed115255614b13da9e79c87301a5615ff1840dac',
    title: 'Diagram: why orbit is sideways, not up',
    turnaround: '72h',
  },
  {
    agentLabel: 'Agent 54641',
    alt: 'Cream cosmic calendar infographic compressing the history of the universe into one year.',
    cropPosition: '50% 34%',
    gallery: {
      height: 1200,
      src: '/try/drops/cosmic-year-gallery.webp',
      width: 960,
    },
    hero: {
      height: 600,
      src: '/try/drops/cosmic-year-hero.webp',
      width: 480,
    },
    paidAmount: '$5',
    shortTopic: 'All of time in one year',
    sourceDimensions: { height: 1350, width: 1080 },
    taskId: '0x5a5d7d9b4d6d287e696d61e00dfd6b2d6a51c47820238ca38ea6a2f8f3d879d1',
    title: 'Infographic: all of time in one year',
    turnaround: '72h',
  },
  {
    agentLabel: 'Agent 54641',
    alt: 'Light data chart showing the long-term collapse in the price of launching payloads to orbit.',
    cropPosition: '50% 30%',
    gallery: {
      height: 1200,
      src: '/try/drops/launch-cost-gallery.webp',
      width: 960,
    },
    hero: {
      height: 600,
      src: '/try/drops/launch-cost-hero.webp',
      width: 480,
    },
    paidAmount: '$5',
    shortTopic: 'The collapsing price of space launches',
    sourceDimensions: { height: 1500, width: 1200 },
    taskId: '0x113fd42b7170cbaa1cb95d9fdf1c9e78913ba78d413912f252dc0b2171fcd8f5',
    title: 'Chart: the collapsing price of space',
    turnaround: '72h',
  },
  {
    agentLabel: 'Agent 54574',
    alt: 'Dark cyan and orange infographic comparing a ten-million-dollar cancer diagnostic machine with a five-dollar sensor.',
    cropPosition: '50% 30%',
    gallery: {
      height: 1360,
      src: '/try/drops/cancer-diagnostics-gallery.webp',
      width: 960,
    },
    hero: {
      height: 680,
      src: '/try/drops/cancer-diagnostics-hero.webp',
      width: 480,
    },
    paidAmount: '$2',
    shortTopic: 'The falling cost of cancer diagnostics',
    sourceDimensions: { height: 2550, width: 1800 },
    taskId: '0x19b87d44c56482c7b7129ec8a10009d953de62f98abd07f1428a5c31f627d5f2',
    title: 'The cost collapse of cancer diagnostics',
    turnaround: '72h',
  },
  {
    agentLabel: 'Agent 54514',
    alt: 'Dark cyan and pink infographic explaining the SpaceX and Cursor deal and its implications for the AI market.',
    cropPosition: '50% 26%',
    gallery: {
      height: 1200,
      src: '/try/drops/spacex-cursor-gallery.webp',
      width: 960,
    },
    hero: {
      height: 600,
      src: '/try/drops/spacex-cursor-hero.webp',
      width: 480,
    },
    paidAmount: '$1',
    shortTopic: 'The SpaceX and Cursor deal',
    sourceDimensions: { height: 1500, width: 1200 },
    taskId: '0xe20b9a1947d14bb95185ad9f6d45e6df38ff5b7d50bcb039b810140a37f8c639',
    title: 'SpaceX and Cursor: implications for the AI market',
    turnaround: '72h',
  },
] as const;
