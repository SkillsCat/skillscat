const DEFAULT_STORAGE_KEY = 'skillscat:search-history:v1';
const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_MAX_ENTRY_LENGTH = 120;

interface SearchHistoryOptions {
  storageKey?: string;
  maxEntries?: number;
  maxEntryLength?: number;
}

function resolveOptions(options: SearchHistoryOptions) {
  return {
    storageKey: options.storageKey || DEFAULT_STORAGE_KEY,
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxEntryLength: options.maxEntryLength ?? DEFAULT_MAX_ENTRY_LENGTH
  };
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeEntry(entry: string, maxEntryLength: number): string {
  return entry.trim().replace(/\s+/g, ' ').slice(0, maxEntryLength);
}

function sanitizeEntries(
  entries: unknown[],
  maxEntries: number,
  maxEntryLength: number
): string[] {
  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeEntry(entry, maxEntryLength))
    .filter(Boolean)
    .slice(0, maxEntries);
}

export function loadSearchHistory(options: SearchHistoryOptions = {}): string[] {
  const storage = getStorage();
  if (!storage) return [];

  const { storageKey, maxEntries, maxEntryLength } = resolveOptions(options);

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return sanitizeEntries(parsed, maxEntries, maxEntryLength);
  } catch {
    return [];
  }
}

export function saveSearchHistory(entries: string[], options: SearchHistoryOptions = {}): void {
  const storage = getStorage();
  if (!storage) return;

  const { storageKey, maxEntries, maxEntryLength } = resolveOptions(options);

  try {
    const sanitized = sanitizeEntries(entries, maxEntries, maxEntryLength);

    if (sanitized.length === 0) {
      storage.removeItem(storageKey);
      return;
    }

    storage.setItem(storageKey, JSON.stringify(sanitized));
  } catch {
    // Ignore storage failures.
  }
}

export function addSearchHistoryEntry(
  entries: string[],
  query: string,
  options: SearchHistoryOptions = {}
): string[] {
  const { maxEntries, maxEntryLength } = resolveOptions(options);
  const normalized = normalizeEntry(query, maxEntryLength);
  if (!normalized) return entries;

  const deduped = [
    normalized,
    ...entries.filter((entry) => normalizeEntry(entry, maxEntryLength).toLowerCase() !== normalized.toLowerCase())
  ];

  return sanitizeEntries(deduped, maxEntries, maxEntryLength);
}

export function filterSearchHistory(
  entries: string[],
  query: string,
  options: SearchHistoryOptions = {}
): string[] {
  const { maxEntries, maxEntryLength } = resolveOptions(options);
  const sanitized = sanitizeEntries(entries, maxEntries, maxEntryLength);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sanitized;

  return sanitized.filter((entry) => entry.toLowerCase().includes(normalizedQuery));
}
