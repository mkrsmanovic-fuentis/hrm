import type { Session } from '../../app/core/api/api-schema.gen';
import { MemoryMockStore } from '../db/mock-store';
import { DEMO_PASSWORD } from '../seed/people.seed';
import { createTestMockApi } from '../testing';

/** A lock like the browser's Web Lock: runs one request at a time, in order. */
function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  const calls = { count: 0 };
  const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
    calls.count++;
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
  return { exclusive, calls };
}

describe('mock routes shared by two tabs', () => {
  function twoTabs() {
    const lock = createLock();
    const store = new MemoryMockStore();
    const options = { signedInAs: null, store, exclusive: lock.exclusive };
    return { tabA: createTestMockApi(options), tabB: createTestMockApi(options), store, lock };
  }

  async function signIn(tab: ReturnType<typeof createTestMockApi>): Promise<Session> {
    const response = await tab.fetch('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'amelia.hughes@brightwater.example', password: DEMO_PASSWORD }),
    });
    expect(response.status).toBe(201);
    return response.json();
  }

  it('lets a tab use a session another tab started', async () => {
    const { tabA, tabB } = twoTabs();

    const session = await signIn(tabA);
    const response = await tabB.fetch('/api/v1/auth/session', {
      headers: { Authorization: `Bearer ${session.token}` },
    });

    expect(response.status).toBe(200);
  });

  it('keeps every write when both tabs write at the same time', async () => {
    const { tabA, tabB, store, lock } = twoTabs();

    const sessions = await Promise.all(
      Array.from({ length: 10 }, (_, i) => signIn(i % 2 === 0 ? tabA : tabB)),
    );

    expect(lock.calls.count).toBe(10);
    const stored = (await store.read())?.data as { sessions: { token: string }[] };
    expect(stored.sessions.map((s) => s.token).sort()).toEqual(sessions.map((s) => s.token).sort());
  });
});
