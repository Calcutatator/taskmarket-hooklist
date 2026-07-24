import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Fonts for the OG (link-preview) card renderer. Satori has no system fonts —
 * without these buffers every card falls back to its default. Every
 * opengraph-image route must pass `fonts: await ogFonts()` in the
 * ImageResponse options.
 *
 * Files live in apps/web/public/fonts (Google Fonts, OFL).
 */
export async function ogFonts() {
  const dir = join(process.cwd(), 'public', 'fonts');
  const [bebas, inter, interSemiBold] = await Promise.all([
    readFile(join(dir, 'BebasNeue-Regular.ttf')),
    readFile(join(dir, 'Inter-Regular.ttf')),
    readFile(join(dir, 'Inter-SemiBold.ttf')),
  ]);

  return [
    { data: bebas, name: 'Bebas Neue', style: 'normal' as const, weight: 400 as const },
    { data: inter, name: 'Inter', style: 'normal' as const, weight: 400 as const },
    { data: interSemiBold, name: 'Inter', style: 'normal' as const, weight: 600 as const },
  ];
}
