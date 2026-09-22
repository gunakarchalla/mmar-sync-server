import type { AccessLevel } from './types';

const TTL_MS = 2000;

interface CacheEntry {
  level: AccessLevel | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(token: string, sceneInstanceUuid: string): string {
  return `${sceneInstanceUuid}:${token}`;
}

export function getCached(
  token: string,
  sceneInstanceUuid: string
): AccessLevel | null | undefined {
  const k = cacheKey(token, sceneInstanceUuid);
  const entry = cache.get(k);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(k);
    return undefined;
  }
  return entry.level;
}

export function setCached(
  token: string,
  sceneInstanceUuid: string,
  level: AccessLevel | null
): void {
  cache.set(cacheKey(token, sceneInstanceUuid), { level, expiresAt: Date.now() + TTL_MS });
}
