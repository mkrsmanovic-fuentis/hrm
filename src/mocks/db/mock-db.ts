import type { MockData } from './mock-data';
import type { MockStore } from './mock-store';

export interface MockDbOptions {
  /** Builds a fresh copy of the seed data. Called on first use and on reset. */
  seed: () => MockData;
  /**
   * Where data is shared between tabs and survives page reloads. `null` keeps everything in
   * memory (unit tests).
   */
  store: MockStore | null;
  /**
   * Bump when the shape of the seed or of a record changes, so browsers holding older
   * data start again from the new seed instead of failing on stale records.
   */
  version: number;
}

/**
 * The database behind the mock API. Handlers read `db.data` and change it only through
 * `db.update()`. Both are synchronous and work on this tab's copy in memory.
 *
 * Every tab of the app shares the stored data, like one backend. The route wrapper keeps the
 * copy in step with the store around each request, inside a lock that runs one request at a time
 * across tabs:
 *
 * 1. `sync()` loads the stored data if another tab saved since this tab last did.
 * 2. The handler reads and changes `data`.
 * 3. `flush()` saves the changes, before the next request in any tab starts.
 */
export class MockDb {
  private current: MockData | null = null;
  /** The stored revision `current` matches, or null when it was never loaded or saved. */
  private revision: string | null = null;
  /** Whether `current` has changes that are not saved yet. */
  private dirty = false;

  constructor(private readonly options: MockDbOptions) {}

  /** Current data. Seeded on first access when nothing was loaded. */
  get data(): MockData {
    if (!this.current) {
      this.current = this.options.seed();
      this.dirty = true;
    }
    return this.current;
  }

  /**
   * Changes data. Return a value from `change` to pass it on. The change is saved by the next
   * `flush()`, which the route wrapper calls after every request.
   *
   * @example
   * const topic = db.update((data) => { data.topics.push(newTopic); return newTopic; });
   */
  update<T>(change: (data: MockData) => T): T {
    const result = change(this.data);
    this.dirty = true;
    return result;
  }

  /** Throws away every change and starts again from the seed. `flush()` saves it. */
  reset(): void {
    this.current = this.options.seed();
    this.dirty = true;
  }

  /**
   * Loads the stored data if another tab saved since this tab last loaded or saved it, or seeds
   * the store when it is empty or holds an older seed version. Records read from `data` before a
   * sync are stale afterwards.
   */
  async sync(): Promise<void> {
    const { store } = this.options;
    if (!store) return;
    if (this.current && !this.dirty && (await store.readRevision()) === this.revision) return;

    const stored = await store.read();
    if (stored && stored.version === this.options.version) {
      this.current = stored.data as MockData;
      this.revision = stored.revision;
      this.dirty = false;
    } else {
      this.reset();
      await this.flush();
    }
  }

  /** Saves the changes since the last save. Does nothing when there are none. */
  async flush(): Promise<void> {
    const { store } = this.options;
    if (!store || !this.dirty || !this.current) return;
    const revision = crypto.randomUUID();
    try {
      await store.write({ revision, version: this.options.version, data: this.current });
      this.revision = revision;
      this.dirty = false;
    } catch (error) {
      // Quota exceeded or storage blocked: keep working in memory for this page load.
      console.warn('[mock api] Could not save mock data; changes will be lost on reload.', error);
    }
  }
}
