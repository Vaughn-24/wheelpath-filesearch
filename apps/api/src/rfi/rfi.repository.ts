import { Injectable } from '@nestjs/common';
import type { Rfi } from '@wheelpath/types';

export interface RfiRepository {
  create(rfi: Rfi): Promise<{ id: string }>;
}

@Injectable()
export class InMemoryRfiRepository implements RfiRepository {
  private readonly store = new Map<string, Rfi>();

  async create(rfi: Rfi): Promise<{ id: string }> {
    const id = `${rfi.tenantId}:${rfi.docNumber}`;
    this.store.set(id, rfi);
    return { id };
  }
}

@Injectable()
export class FirestoreRfiRepository implements RfiRepository {
  private firestore?: any;

  constructor() {
    try {
      // Dynamically import to avoid requiring in tests without emulator
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Firestore } = require('@google-cloud/firestore');
      this.firestore = new Firestore();
    } catch {
      this.firestore = undefined;
    }
  }

  async create(rfi: Rfi): Promise<{ id: string }> {
    if (!this.firestore) {
      const id = `${rfi.tenantId}:${rfi.docNumber}`;
      return { id };
    }
    const id = `${rfi.docNumber}`;
    const ref = this.firestore.collection('tenants').doc(rfi.tenantId).collection('rfi').doc(id);
    await ref.set(
      { ...rfi, createdAt: rfi.createdAt || new Date().toISOString() },
      { merge: true },
    );
    return { id: `${rfi.tenantId}:${id}` };
  }
}
