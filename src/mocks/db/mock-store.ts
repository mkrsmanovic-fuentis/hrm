/**
 * Where the mock data is kept between requests and page loads, shared by every tab of the app.
 * Each save gets a new revision, so a tab can check cheaply whether another tab wrote.
 *
 * The browser uses {@link IndexedDbMockStore}. Its transactions are consistent across tabs: once
 * a write has finished, every tab reads it. localStorage is not: right after another tab's write,
 * a tab can still read the old value, and its next save would undo that write.
 */
export interface MockStore {
  /** The revision of the stored data, or null when nothing is stored. */
  readRevision(): Promise<string | null>;
  /** The stored data and its revision, or null when nothing is stored. */
  read(): Promise<StoredMockData | null>;
  /** Replaces the stored data. */
  write(stored: StoredMockData): Promise<void>;
}

export interface StoredMockData {
  revision: string;
  /** Seed version the data was made with. See `MockDbOptions.version`. */
  version: number;
  data: unknown;
}

/** A store in memory. Give two `MockDb`s the same one to test two tabs sharing the data. */
export class MemoryMockStore implements MockStore {
  private stored: StoredMockData | null = null;

  async readRevision(): Promise<string | null> {
    return this.stored?.revision ?? null;
  }

  async read(): Promise<StoredMockData | null> {
    return this.stored ? structuredClone(this.stored) : null;
  }

  async write(stored: StoredMockData): Promise<void> {
    this.stored = structuredClone(stored);
  }
}

const DB_NAME = 'hrm-mock-api';
const OBJECT_STORE = 'state';
const DATA_KEY = 'data';
const REVISION_KEY = 'revision';

/** The browser's store: one IndexedDB database for the origin, shared by every tab. */
export class IndexedDbMockStore implements MockStore {
  private connection: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  async readRevision(): Promise<string | null> {
    const db = await this.open();
    const request = db.transaction(OBJECT_STORE).objectStore(OBJECT_STORE).get(REVISION_KEY);
    return ((await done(request)) as string | undefined) ?? null;
  }

  async read(): Promise<StoredMockData | null> {
    const db = await this.open();
    const store = db.transaction(OBJECT_STORE).objectStore(OBJECT_STORE);
    const [revision, stored] = await Promise.all([
      done(store.get(REVISION_KEY)),
      done(store.get(DATA_KEY)),
    ]);
    if (typeof revision !== 'string' || !stored) return null;
    const { version, data } = stored as { version: number; data: unknown };
    return { revision, version, data };
  }

  async write({ revision, version, data }: StoredMockData): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(OBJECT_STORE, 'readwrite');
    const store = transaction.objectStore(OBJECT_STORE);
    store.put({ version, data }, DATA_KEY);
    store.put(revision, REVISION_KEY);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(OBJECT_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.connection;
  }
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
