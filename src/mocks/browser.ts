import { setupWorker } from 'msw/browser';
import { environment } from '../environments/environment';
import { MockDb } from './db/mock-db';
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
    storage: storageOrNull(() => window.localStorage),
    version: SEED_VERSION,
  });

  const url = new URL(window.location.href);
  if (url.searchParams.has(FLAG_PARAMS.reset)) {
    db.reset();
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
    }),
  );
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true });

  window.hrmMockApi = {
    reset: () => {
      db.reset();
      window.location.reload();
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

function storageOrNull(get: () => Storage): Storage | null {
  try {
    return get();
  } catch {
    return null;
  }
}
