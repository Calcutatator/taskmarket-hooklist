export function isActivePath(pathname: string, href: string, exact = false) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const normalizedHref = href.replace(/\/+$/, '') || '/';

  if (exact) {
    return normalizedPath === normalizedHref;
  }

  return normalizedPath === normalizedHref || normalizedPath.startsWith(`${normalizedHref}/`);
}
