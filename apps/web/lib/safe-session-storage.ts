export function getSessionStorageItem(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function removeSessionStorageItem(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage is an optional enhancement.
  }
}

export function setSessionStorageItem(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage is an optional enhancement.
  }
}
