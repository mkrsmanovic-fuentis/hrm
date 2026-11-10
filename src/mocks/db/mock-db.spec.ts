import { buildSeed } from '../seed/seed';
import { TEST_NOW } from '../testing';
import { MockDb } from './mock-db';
import type { MockData } from './mock-data';
import { MemoryMockStore } from './mock-store';

describe('MockDb', () => {
  const seedData = buildSeed(TEST_NOW);
  const seed = () => structuredClone(seedData);
  let store: MemoryMockStore;

  beforeEach(() => {
    store = new MemoryMockStore();
  });

  /** A tab: a database on the shared store, synced as the route wrapper does before a request. */
  async function openTab(version = 1) {
    const db = new MockDb({ seed, store, version });
    await db.sync();
    return db;
  }

  /** One request in a tab: sync, change, save, as the route wrapper does inside the lock. */
  async function request(db: MockDb, change: (data: MockData) => void) {
    await db.sync();
    db.update(change);
    await db.flush();
  }

  it('starts from the seed and saves it', async () => {
    const db = await openTab();

    expect(db.data.topics).toHaveLength(8);
    expect(await store.read()).toMatchObject({ version: 1, data: { topics: seedData.topics } });
  });

  it('keeps saved changes across a reload', async () => {
    await request(await openTab(), (data) => {
      data.organization.name = 'Renamed Ltd';
    });

    const afterReload = await openTab();

    expect(afterReload.data.organization.name).toBe('Renamed Ltd');
  });

  it('saves only on flush', async () => {
    const db = await openTab();
    const revision = await store.readRevision();

    db.update((data) => {
      data.organization.name = 'Renamed Ltd';
    });
    expect(await store.readRevision()).toBe(revision);

    await db.flush();
    expect(await store.readRevision()).not.toBe(revision);
    await db.flush();
    expect((await store.read())?.data).toMatchObject({ organization: { name: 'Renamed Ltd' } });
  });

  describe('shared by two tabs', () => {
    it("keeps both tabs' writes when each request syncs first", async () => {
      const tabA = await openTab();
      const tabB = await openTab();

      // Each tab has loaded the data before the other writes.
      await request(tabA, (data) => data.sessions.push(session('a')));
      await request(tabB, (data) => data.sessions.push(session('b')));
      await request(tabA, (data) => data.sessions.push(session('c')));

      const tokens = ['a', 'b', 'c'];
      expect(tabA.data.sessions.map((s) => s.token)).toEqual(tokens);
      expect((await openTab()).data.sessions.map((s) => s.token)).toEqual(tokens);
    });

    it("loads the other tab's data on sync, and keeps its own copy when nothing changed", async () => {
      const tabA = await openTab();
      const tabB = await openTab();
      const own = tabB.data;

      await tabB.sync();
      expect(tabB.data).toBe(own);

      await request(tabA, (data) => {
        data.organization.name = 'Renamed Ltd';
      });
      expect(tabB.data.organization.name).toBe(seedData.organization.name);
      await tabB.sync();
      expect(tabB.data.organization.name).toBe('Renamed Ltd');
    });

    it('follows a reset in the other tab', async () => {
      const tabA = await openTab();
      const tabB = await openTab();
      await request(tabB, (data) => data.sessions.push(session('b')));

      await tabA.sync();
      tabA.reset();
      await tabA.flush();
      await tabB.sync();

      expect(tabB.data.sessions).toEqual([]);
    });

    function session(token: string) {
      const at = TEST_NOW.toISOString();
      return { token, userId: 'user-1', createdAt: at, expiresAt: at };
    }
  });

  it('returns the value from update', async () => {
    const db = await openTab();

    const count = db.update((data) => data.topics.length);

    expect(count).toBe(8);
  });

  it('resets to the seed', async () => {
    const db = await openTab();
    await request(db, (data) => data.topics.splice(0, 3));

    db.reset();
    await db.flush();

    expect(db.data.topics).toHaveLength(8);
    expect((await openTab()).data.topics).toHaveLength(8);
  });

  it('starts again from the seed when the stored version is older', async () => {
    await request(await openTab(1), (data) => {
      data.topics = [];
    });

    expect((await openTab(2)).data.topics).toHaveLength(8);
    expect(await store.read()).toMatchObject({ version: 2 });
  });

  it('works in memory without a store', async () => {
    const db = new MockDb({ seed, store: null, version: 1 });
    db.update((data: MockData) => data.users.pop());
    await db.sync();
    await db.flush();

    expect(db.data.users).toHaveLength(seedData.users.length - 1);
  });
});
