type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export function getCached<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed?.expiresAt || Date.now() > parsed.expiresAt) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, value: T, ttlMs = 60_000) {
  if (typeof window === "undefined") return;
  try {
    const payload: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
    };
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore quota/storage errors
  }
}

export function clearCacheByPrefix(prefix: string) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(window.sessionStorage);
    keys.forEach((key) => {
      if (key.startsWith(prefix)) {
        window.sessionStorage.removeItem(key);
      }
    });
  } catch {
    // ignore storage errors
  }
}
