import { renderStaticOgImage } from '@/lib/static-og-image';
import { staticOgConfigs } from '@/lib/static-og';

export const alt = staticOgConfigs.humans.imageAlt;
export { contentType, size } from '@/lib/static-og-image';

export default function Image() {
  return renderStaticOgImage('humans');
}
