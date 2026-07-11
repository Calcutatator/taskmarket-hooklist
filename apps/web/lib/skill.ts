import { getSiteUrl } from '@/lib/seo';

export function skillInstallCommand() {
  const siteUrl = getSiteUrl();
  return `curl -fsSL ${siteUrl}/install-skill.sh | sh -s -- ${siteUrl}`;
}
