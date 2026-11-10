import { buildSeed } from '../seed/seed';
import { TEST_NOW } from '../testing';
import { MockDb } from './mock-db';
import type { MockData } from './mock-data';

describe('MockDb', () => {
  const seedData = buildSeed(TEST_NOW);
  const seed = () => structuredClone(seedData);
  let storage: Storage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  function createDb(version = 1) {
    return new MockDb({ seed, storage, version, storageKey: 'test.db' });
  }

  it('starts from the seed and saves it', () => {
    const db = createDb();

    expect(db.data.topics).toHaveLength(7);
    expect(storage.getItem('test.db')).not.toBeNull();
  });

  it('keeps changes across a reload', () => {
    createDb().update((data) => {
      data.organization.name = 'Renamed Ltd';
    });

    const afterReload = createDb();

    expect(afterReload.data.organization.name).toBe('Renamed Ltd');
  });

  it('serves the data another tab saved, like one shared backend', () => {
    const thisTab = createDb();
    const otherTab = createDb();
    expect(thisTab.data.organization.name).toBe(seedData.organization.name);

    otherTab.update((data) => {
      data.organization.name = 'Renamed Ltd';
    });

    expect(thisTab.syncFromOtherTab({ key: 'unrelated' })).toBe(false);
    expect(thisTab.data.organization.name).toBe(seedData.organization.name);
    expect(thisTab.syncFromOtherTab({ key: 'test.db' })).toBe(true);
    expect(thisTab.data.organization.name).toBe('Renamed Ltd');
  });

  it('returns the value from update', () => {
    const db = createDb();

    const count = db.update((data) => data.topics.length);

    expect(count).toBe(7);
  });

  it('resets to the seed', () => {
    const db = createDb();
    db.update((data) => data.topics.splice(0, 3));

    db.reset();

    expect(db.data.topics).toHaveLength(7);
    expect(createDb().data.topics).toHaveLength(7);
  });

  it('starts again from the seed when the stored version is older', () => {
    createDb(1).update((data) => {
      data.topics = [];
    });

    expect(createDb(2).data.topics).toHaveLength(7);
  });

  it('starts again from the seed when stored data is unreadable', () => {
    storage.setItem('test.db', '{not json');

    expect(createDb().data.topics).toHaveLength(7);
  });

  it('works in memory without storage', () => {
    const db = new MockDb({ seed, storage: null, version: 1 });
    db.update((data: MockData) => data.users.pop());

    expect(db.data.users).toHaveLength(seedData.users.length - 1);
  });
});

/** A Storage that lives only in memory, so tests never touch the browser's localStorage. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}
