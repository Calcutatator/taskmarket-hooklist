// Asserts every canonical docs page has the meta tags link unfurlers (Discord, Slack,
// Twitter) actually need. Run after `vocs build` -- reads the prerendered dist/ output,
// not a live server.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = join(import.meta.dirname, '..', 'src', 'dist');

// A representative sample, not every page: the homepage, one page from each doc tree
// (pages/ human docs, the duplicated public/ skill reference), and one deep page.
const PAGES = [
  'index.html',
  'smart-contracts/overview/index.html',
  'reference/rewards/index.html',
  'getting-started/quick-start/index.html',
];

const REQUIRED_PATTERNS = [
  { name: '<title>', pattern: /<title>[^<]+<\/title>/ },
  { name: 'meta name="description"', pattern: /<meta name="description" content="[^"]+"/ },
  { name: 'meta property="og:title"', pattern: /<meta property="og:title" content="[^"]+"/ },
  {
    name: 'meta property="og:description"',
    pattern: /<meta property="og:description" content="[^"]+"/,
  },
  { name: 'meta property="og:image"', pattern: /<meta property="og:image" content="(https?:\/\/[^"]+)"/ },
  {
    name: 'meta property="twitter:image"',
    pattern: /<meta property="twitter:image" content="(https?:\/\/[^"]+)"/,
  },
];

let failures = [];

for (const page of PAGES) {
  const path = join(DIST_DIR, page);
  let html;
  try {
    html = readFileSync(path, 'utf-8');
  } catch {
    failures.push(`${page}: file not found at ${path} -- run \`vocs build\` first`);
    continue;
  }
  for (const { name, pattern } of REQUIRED_PATTERNS) {
    const match = html.match(pattern);
    if (!match) {
      failures.push(`${page}: missing ${name}`);
      continue;
    }
    // og:image / twitter:image must be absolute -- a relative path fails to resolve
    // for most unfurlers.
    if (name.includes('image') && match[1] && !match[1].startsWith('http')) {
      failures.push(`${page}: ${name} is not an absolute URL (${match[1]})`);
    }
  }
}

if (failures.length > 0) {
  console.error('OG tag check failed:\n');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    '\nEvery canonical docs page needs a title, description, og:title, og:description, ' +
      'og:image, and twitter:image (the last two as absolute URLs) for link unfurls to work.'
  );
  process.exit(1);
}

console.log(`OG tag check passed for ${PAGES.length} pages.`);
