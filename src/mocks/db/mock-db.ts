import type { MockData } from './mock-data';

export interface MockDbOptions {
  /** Builds a fresh copy of the seed data. Called on first use and on reset. */
  seed: () => MockData;
  /** Where data survives page reloads. `null` keeps everything in memory (unit tests). */
  storage: Storage | null;
  /** Storage key. */
  storageKey?: string;
  /**
   * Bump when the shape of the seed or of a record changes, so browsers holding older
   * data start again from the new seed instead of failing on stale records.
   */
  version: number;
}

interface StoredData {
  version: number;
  data: MockData;
}

/**
 * The in-memory database behind the mock API. Handlers read `db.data` and change it only
 * through `db.update()`, which saves the result to localStorage so it survives a reload.
 */
export class MockDb {
  private current: MockData | null = null;
  private readonly storageKey: string;

  constructor(private readonly options: MockDbOptions) {
    this.storageKey = options.storageKey ?? 'hrm.mockApi.db';
  }

  /** Current data. Loaded from storage, or seeded, on first access. */
  get data(): MockData {
    this.current ??= this.load() ?? this.seedAndSave();
    return this.current;
  }

  /**
   * Changes data and saves it. Return a value from `change` to pass it on.
   *
   * @example
   * const topic = db.update((data) => { data.topics.push(newTopic); return newTopic; });
   */
  update<T>(change: (data: MockData) => T): T {
    const result = change(this.data);
    this.save();
    return result;
  }

  /** Throws away every change and starts again from the seed. */
  reset(): void {
    this.current = this.seedAndSave();
  }

  private seedAndSave(): MockData {
    this.current = this.options.seed();
    this.save();
    return this.current;
  }

  private load(): MockData | null {
    const raw = this.readStorage();
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as StoredData;
      return stored.version === this.options.version ? stored.data : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    if (!this.options.storage || !this.current) return;
    const stored: StoredData = { version: this.options.version, data: this.current };
    try {
      this.options.storage.setItem(this.storageKey, JSON.stringify(stored));
    } catch (error) {
      // Quota exceeded or storage blocked: keep working in memory for this page load.
      console.warn('[mock api] Could not save mock data; changes will be lost on reload.', error);
    }
  }

  private readStorage(): string | null {
    try {
      return this.options.storage?.getItem(this.storageKey) ?? null;
    } catch {
      return null;
    }
  }
}
