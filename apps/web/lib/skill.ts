import { getSiteUrl } from '@/lib/seo';

export function skillInstallCommand() {
  return `curl -fsSL ${getSiteUrl()}/skill.md -o skill.md`;
}
