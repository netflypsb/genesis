import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import type { SourceCollection } from '../types.js';
import { getDb } from '../store/db.js';

interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  source_ids: string;
  created_at: string;
  updated_at: string;
}

export class CollectionStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  create(name: string, sourceIds: string[], description?: string): SourceCollection {
    const db = getDb(this.config);
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO collections (id, name, description, source_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, description || null, JSON.stringify(sourceIds), now, now);

    return { id, name, description, sourceIds, createdAt: now, updatedAt: now };
  }

  get(id: string): SourceCollection | null {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT * FROM collections WHERE id = ?`).get(id) as CollectionRow | undefined;
    return row ? this.rowToCollection(row) : null;
  }

  list(): SourceCollection[] {
    const db = getDb(this.config);
    const rows = db.prepare(`SELECT * FROM collections ORDER BY created_at DESC`).all() as CollectionRow[];
    return rows.map((r) => this.rowToCollection(r));
  }

  delete(id: string): void {
    const db = getDb(this.config);
    db.prepare(`DELETE FROM collections WHERE id = ?`).run(id);
  }

  private rowToCollection(row: CollectionRow): SourceCollection {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      sourceIds: JSON.parse(row.source_ids),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
