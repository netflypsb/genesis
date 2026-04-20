import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import type { EmbeddingChunk, SemanticSearchResult } from '../types.js';
import { getDb } from './db.js';

interface EmbeddingRow {
  id: string;
  source_id: string;
  scope_id: string;
  chunk_text: string;
  embedding: Buffer;
  model: string;
  dimensions: number;
  created_at: string;
}

export class EmbeddingStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  save(sourceId: string, scopeId: string, chunkText: string, embedding: Float32Array, model: string): string {
    const db = getDb(this.config);
    const id = uuidv4();
    const now = new Date().toISOString();
    const buffer = Buffer.from(embedding.buffer);

    db.prepare(`
      INSERT INTO embeddings (id, source_id, scope_id, chunk_text, embedding, model, dimensions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, scopeId, chunkText, buffer, model, embedding.length, now);

    return id;
  }

  search(sourceId: string, queryEmbedding: Float32Array, topK: number = 10, scopeFilter?: string): SemanticSearchResult[] {
    const db = getDb(this.config);

    let query = `SELECT * FROM embeddings WHERE source_id = ?`;
    const params: any[] = [sourceId];

    if (scopeFilter) {
      query += ` AND scope_id LIKE ?`;
      params.push(`${scopeFilter}%`);
    }

    const rows = db.prepare(query).all(...params) as EmbeddingRow[];

    // Compute cosine similarity
    const scored: SemanticSearchResult[] = [];
    for (const row of rows) {
      const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dimensions);
      const score = cosineSimilarity(queryEmbedding, stored);
      scored.push({
        chunkText: row.chunk_text,
        scopeId: row.scope_id,
        score,
        sourceId: row.source_id,
      });
    }

    // Sort by score descending, take topK
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  deleteForSource(sourceId: string): number {
    const db = getDb(this.config);
    const result = db.prepare(`DELETE FROM embeddings WHERE source_id = ?`).run(sourceId);
    return result.changes;
  }

  countForSource(sourceId: string): number {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM embeddings WHERE source_id = ?`).get(sourceId) as { cnt: number };
    return row.cnt;
  }

  hasEmbeddings(sourceId: string): boolean {
    return this.countForSource(sourceId) > 0;
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
