import { setupWorker } from 'msw/browser';
import { environment } from '../environments/environment';
import { MockDb } from './db/mock-db';
import { IndexedDbMockStore } from './db/mock-store';
import type { MockData } from './db/mock-data';
import { createHandlers } from './handlers';
import { buildSeed, SEED_VERSION } from './seed/seed';
import { describeFlags, FLAG_PARAMS, loadFlags, type SimulationFlags } from './support/simulation';

declare global {
  interface Window {
    /** Mock API helpers for the browser console. Only present while the mock is on. */
    hrmMockApi?: {
      /** Throws away all changes, restores the seed data and reloads the page. */
      reset(): void;
      /** The current mock data. */
      data(): MockData;
      /** The simulation flags in effect for this tab. */
      flags: SimulationFlags;
    };
  }
}

/**
 * Starts the mock API in the browser. main.ts awaits this before bootstrapping the app,
 * so the very first request is already answered by the mock.
 */
export async function startMockApi(): Promise<void> {
  const db = new MockDb({
    seed: () => buildSeed(),
    store: typeof indexedDB === 'undefined' ? null : new IndexedDbMockStore(indexedDB),
    version: SEED_VERSION,
  });
  const exclusive = crossTabLock();
  const withLock = (run: () => Promise<void>) => (exclusive ? exclusive(run) : run());
  // Remove mock data saved before it moved to IndexedDB.
  storageOrNull(() => window.localStorage)?.removeItem('hrm.mockApi.db');

  const url = new URL(window.location.href);
  if (url.searchParams.has(FLAG_PARAMS.reset)) {
    await withLock(async () => {
      db.reset();
      await db.flush();
    });
    // Drop the parameter, so a reload keeps the data you create next.
    url.searchParams.delete(FLAG_PARAMS.reset);
    window.history.replaceState(window.history.state, '', url);
    console.info('[mock api] Mock data reset to the seed.');
  }

  const flags = loadFlags(
    window.location,
    storageOrNull(() => window.sessionStorage),
  );
  const worker = setupWorker(
    ...createHandlers({
      db,
      baseUrl: environment.apiBaseUrl,
      flags: () => flags,
      latency: 'real',
      now: () => new Date(),
      exclusive,
    }),
  );
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true });

  window.hrmMockApi = {
    reset: () => {
      void withLock(async () => {
        db.reset();
        await db.flush();
      }).then(() => window.location.reload());
    },
    data: () => db.data,
    flags,
  };

  const simulating = describeFlags(flags);
  console.info(
    `[mock api] Serving ${environment.apiBaseUrl} from the in-browser mock.` +
      (simulating ? ` Simulating: ${simulating}` : '') +
      ' Run hrmMockApi.reset() to restore the seed data.',
  );
}

/**
 * Tabs of the app share the mock data like one backend. A Web Lock runs one request at a time
 * across all of them, from loading the latest data to saving the changes, so no tab's write is
 * lost. Browsers without Web Locks run requests without it.
 */
function crossTabLock(): (<T>(run: () => Promise<T>) => Promise<T>) | undefined {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return undefined;
  return (run) => locks.request('hrm.mockApi.db', run);
}

function storageOrNull(get: () => Storage): Storage | null {
  try {
    return get();
  } catch {
    return null;
  }
}
