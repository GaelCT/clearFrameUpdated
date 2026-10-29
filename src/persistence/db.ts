/**
 * Minimal promise wrapper around IndexedDB.
 *
 * Stores:
 *   projects  – project documents (metadata, script, findings, decisions, prompts)
 *   blobs     – imported video files, keyed by asset ID
 */
const DB_NAME = 'clearframe';
const DB_VERSION = 1;
export const STORE_PROJECTS = 'projects';
export const STORE_BLOBS = 'blobs';

export type StorageErrorCode = 'unavailable' | 'quota' | 'blocked' | 'corrupt' | 'unknown';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function toStorageError(err: unknown, action: string): StorageError {
  if (err instanceof StorageError) return err;
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', `Browser storage is full, so ClearFrame could not ${action}. Free space or remove large videos.`, {
      cause: err,
    });
  }
  if (name === 'InvalidStateError' || name === 'SecurityError') {
    return new StorageError(
      'unavailable',
      `Browser storage is not available (it may be disabled or in private mode), so ClearFrame could not ${action}.`,
      { cause: err },
    );
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return new StorageError('unknown', `ClearFrame could not ${action}${detail}.`, { cause: err });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('unavailable', 'This browser does not provide IndexedDB storage.'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(toStorageError(err, 'open browser storage'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS, { keyPath: 'assetId' });
    };
    request.onblocked = () =>
      reject(new StorageError('blocked', 'Browser storage is locked by another ClearFrame tab. Close other tabs and reload.'));
    request.onerror = () => reject(toStorageError(request.error, 'open browser storage'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T>(store: string, key: IDBValidKey, action: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, 'readonly');
    return (await requestToPromise(tx.objectStore(store).get(key))) as T | undefined;
  } catch (err) {
    throw toStorageError(err, action);
  }
}

export async function idbGetAll<T>(store: string, action: string): Promise<T[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, 'readonly');
    return (await requestToPromise(tx.objectStore(store).getAll())) as T[];
  } catch (err) {
    throw toStorageError(err, action);
  }
}

export async function idbHasKey(store: string, key: IDBValidKey, action: string): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, 'readonly');
    const found = await requestToPromise(tx.objectStore(store).getKey(key));
    return found !== undefined;
  } catch (err) {
    throw toStorageError(err, action);
  }
}

export async function idbPut(store: string, value: unknown, action: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await transactionDone(tx);
  } catch (err) {
    throw toStorageError(err, action);
  }
}

export async function idbDelete(store: string, keys: IDBValidKey[], action: string): Promise<void> {
  if (keys.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const key of keys) os.delete(key);
    await transactionDone(tx);
  } catch (err) {
    throw toStorageError(err, action);
  }
}

/** For tests: forget the cached connection. */
export function resetDbConnection(): void {
  dbPromise = null;
}
