import { PowerSyncDatabase, UpdateType, type AbstractPowerSyncDatabase, type PowerSyncBackendConnector } from '@powersync/react-native';
import { API_URL, POWERSYNC_URL } from './config';
import { AppSchema } from './schema';
import { dbKey, freshSession, type Session } from './session';

let instance: PowerSyncDatabase | null = null;

export async function openDatabase(): Promise<PowerSyncDatabase> {
  if (instance) return instance;
  instance = new PowerSyncDatabase({
    schema: AppSchema,
    // Encrypted at rest (docs 05 "Sicherheit"): SQLCipher via op-sqlite, key from the Keychain.
    database: { dbFilename: 'bauaktepro.db', sqliteOptions: { encryptionKey: await dbKey() } },
  });
  await instance.init();
  return instance;
}

export class Connector implements PowerSyncBackendConnector {
  constructor(private session: Session, private deviceId: string) {}

  async fetchCredentials() {
    this.session = await freshSession(this.session);
    return { endpoint: POWERSYNC_URL, token: this.session.token };
  }

  /** Sends the local write queue to our API. Business rejections come back as results (never thrown). */
  async uploadData(db: AbstractPowerSyncDatabase) {
    const batch = await db.getCrudBatch(50);
    if (!batch) return;
    const ops = batch.crud.map((e) => ({
      op: e.op === UpdateType.PUT ? 'PUT' : e.op === UpdateType.PATCH ? 'PATCH' : 'DELETE',
      table: e.table,
      id: e.id,
      data: e.opData ?? null,
    }));
    const res = await fetch(`${API_URL}/sync/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.session.token}`, 'x-device-id': this.deviceId },
      body: JSON.stringify({ ops }),
    });
    // Network/server errors: throw → PowerSync retries later. Everything else is done.
    if (!res.ok) throw new Error(`Upload fehlgeschlagen (${res.status})`);
    await batch.complete();
  }
}
