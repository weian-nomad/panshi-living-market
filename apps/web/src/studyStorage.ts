import type { StudyEvent, StudyVisitOrdinal } from "./study";

const DATABASE_NAME = "panshi-v4-study";
const DATABASE_VERSION = 1;
const EVENT_STORE = "events";
const META_STORE = "meta";

type StudyMetaRecord = {
  key: string;
  value: string | number | boolean;
};

export interface StudyEventStore {
  append(event: StudyEvent): Promise<void>;
  readAll(): Promise<StudyEvent[]>;
  clearAll(): Promise<void>;
  hasConsent(participantCode: string, consentVersion: string): Promise<boolean>;
  recordConsent(participantCode: string, consentVersion: string): Promise<void>;
  allocateAttempt(participantCode: string, visitOrdinal: StudyVisitOrdinal): Promise<number>;
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), {
      once: true,
    });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(EVENT_STORE)) {
      const events = database.createObjectStore(EVENT_STORE, { keyPath: "eventId" });
      events.createIndex("participantCode", "participantCode", { unique: false });
      events.createIndex("runId", "runId", { unique: false });
    }
    if (!database.objectStoreNames.contains(META_STORE)) {
      database.createObjectStore(META_STORE, { keyPath: "key" });
    }
  });
  return requestResult(request);
}

function consentKey(participantCode: string, consentVersion: string): string {
  return `consent/${participantCode}/${consentVersion}`;
}

function attemptKey(participantCode: string, visitOrdinal: StudyVisitOrdinal): string {
  return `attempt/${participantCode}/${visitOrdinal}`;
}

export class IndexedDbStudyStore implements StudyEventStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase();
    return this.databasePromise;
  }

  async append(event: StudyEvent): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(EVENT_STORE, "readwrite");
    transaction.objectStore(EVENT_STORE).add(event);
    await transactionComplete(transaction);
  }

  async readAll(): Promise<StudyEvent[]> {
    const database = await this.database();
    const transaction = database.transaction(EVENT_STORE, "readonly");
    const events = await requestResult(transaction.objectStore(EVENT_STORE).getAll());
    await transactionComplete(transaction);
    return events as StudyEvent[];
  }

  async clearAll(): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction([EVENT_STORE, META_STORE], "readwrite");
    transaction.objectStore(EVENT_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    await transactionComplete(transaction);
  }

  async hasConsent(participantCode: string, consentVersion: string): Promise<boolean> {
    const database = await this.database();
    const transaction = database.transaction(META_STORE, "readonly");
    const record = await requestResult<StudyMetaRecord | undefined>(
      transaction.objectStore(META_STORE).get(consentKey(participantCode, consentVersion)),
    );
    await transactionComplete(transaction);
    return record?.value === true;
  }

  async recordConsent(participantCode: string, consentVersion: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(META_STORE, "readwrite");
    const record: StudyMetaRecord = {
      key: consentKey(participantCode, consentVersion),
      value: true,
    };
    transaction.objectStore(META_STORE).put(record);
    await transactionComplete(transaction);
  }

  async allocateAttempt(
    participantCode: string,
    visitOrdinal: StudyVisitOrdinal,
  ): Promise<number> {
    const database = await this.database();
    const transaction = database.transaction(META_STORE, "readwrite");
    const store = transaction.objectStore(META_STORE);
    const key = attemptKey(participantCode, visitOrdinal);
    const current = await requestResult<StudyMetaRecord | undefined>(store.get(key));
    const next = typeof current?.value === "number" ? current.value + 1 : 1;
    store.put({ key, value: next } satisfies StudyMetaRecord);
    await transactionComplete(transaction);
    return next;
  }
}
