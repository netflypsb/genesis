import type { K01Config } from '../config.js';
import type { AnalysisEntry, SaveAnalysisOptions, UpdateAnalysisOptions } from '../types.js';
import { getDb } from './db.js';

interface AnalysisRow {
  id: string;
  source_id: string;
  scope_id: string;
  analysis_type: string;
  content: string;
  model: string | null;
  version: number;
  tags: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export class AnalysisStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  save(options: SaveAnalysisOptions): AnalysisEntry {
    const db = getDb(this.config);
    const now = new Date().toISOString();
    const id = `${options.sourceId}-${options.scopeId}-${options.analysisType}`;

    // Check if analysis already exists — if so, bump version
    const existing = db.prepare(
      `SELECT version, content FROM analyses WHERE source_id = ? AND scope_id = ? AND analysis_type = ?`
    ).get(options.sourceId, options.scopeId, options.analysisType) as { version: number; content: string } | undefined;

    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO analyses (id, source_id, scope_id, analysis_type, content, version, tags, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, scope_id, analysis_type) DO UPDATE SET
        content = excluded.content,
        version = excluded.version,
        tags = excluded.tags,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(
      id,
      options.sourceId,
      options.scopeId,
      options.analysisType,
      options.content,
      version,
      options.tags ? JSON.stringify(options.tags) : null,
      options.confidence ?? null,
      existing ? existing.content : now, // preserve original created_at via not changing it on conflict
      now,
    );

    // Fix created_at: if new, set it; on conflict the INSERT sets created_at to now,
    // but ON CONFLICT UPDATE doesn't touch it. Let's re-read.
    const row = this.getRow(options.sourceId, options.scopeId, options.analysisType);
    return this.rowToEntry(row!);
  }

  get(sourceId: string, scopeId: string, analysisType: string): AnalysisEntry | null {
    const row = this.getRow(sourceId, scopeId, analysisType);
    return row ? this.rowToEntry(row) : null;
  }

  getById(id: string): AnalysisEntry | null {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT * FROM analyses WHERE id = ?`).get(id) as any;
    return row ? this.rowToEntry(row) : null;
  }

  update(options: UpdateAnalysisOptions): AnalysisEntry {
    const db = getDb(this.config);
    const now = new Date().toISOString();

    const existing = db.prepare(
      `SELECT * FROM analyses WHERE source_id = ? AND scope_id = ? AND analysis_type = ?`
    ).get(options.sourceId, options.scopeId, options.analysisType) as AnalysisRow | undefined;

    if (!existing) {
      throw new Error(
        `No analysis found for source=${options.sourceId}, scope=${options.scopeId}, type=${options.analysisType}. Use k01_save_analysis to create one first.`
      );
    }

    const newContent = options.append
      ? existing.content + '\n\n' + options.content
      : options.content;

    const newVersion = existing.version + 1;

    db.prepare(`
      UPDATE analyses SET content = ?, version = ?, updated_at = ?
      WHERE source_id = ? AND scope_id = ? AND analysis_type = ?
    `).run(newContent, newVersion, now, options.sourceId, options.scopeId, options.analysisType);

    const row = this.getRow(options.sourceId, options.scopeId, options.analysisType);
    return this.rowToEntry(row!);
  }

  list(sourceId: string, scopeId?: string, analysisType?: string): AnalysisEntry[] {
    const db = getDb(this.config);

    let query = `SELECT * FROM analyses WHERE source_id = ?`;
    const params: any[] = [sourceId];

    if (scopeId) {
      query += ` AND scope_id = ?`;
      params.push(scopeId);
    }
    if (analysisType) {
      query += ` AND analysis_type = ?`;
      params.push(analysisType);
    }

    query += ` ORDER BY updated_at DESC`;

    const rows = db.prepare(query).all(...params) as AnalysisRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  delete(sourceId: string, scopeId: string, analysisType: string): boolean {
    const db = getDb(this.config);
    const result = db.prepare(
      `DELETE FROM analyses WHERE source_id = ? AND scope_id = ? AND analysis_type = ?`
    ).run(sourceId, scopeId, analysisType);
    return result.changes > 0;
  }

  deleteAllForSource(sourceId: string): number {
    const db = getDb(this.config);
    const result = db.prepare(`DELETE FROM analyses WHERE source_id = ?`).run(sourceId);
    return result.changes;
  }

  getAnalysisSummary(sourceId: string, analysisTypes?: string[]): {
    sourceId: string;
    totalAnalyses: number;
    byScope: Record<string, { types: string[]; lastUpdated: string }>;
    byType: Record<string, number>;
  } {
    const analyses = this.list(sourceId);

    let filtered = analyses;
    if (analysisTypes && analysisTypes.length > 0) {
      const typeSet = new Set(analysisTypes);
      filtered = analyses.filter((a) => typeSet.has(a.analysisType));
    }

    const byScope: Record<string, { types: string[]; lastUpdated: string }> = {};
    const byType: Record<string, number> = {};

    for (const a of filtered) {
      if (!byScope[a.scopeId]) {
        byScope[a.scopeId] = { types: [], lastUpdated: a.updatedAt };
      }
      byScope[a.scopeId].types.push(a.analysisType);
      if (a.updatedAt > byScope[a.scopeId].lastUpdated) {
        byScope[a.scopeId].lastUpdated = a.updatedAt;
      }

      byType[a.analysisType] = (byType[a.analysisType] || 0) + 1;
    }

    return {
      sourceId,
      totalAnalyses: filtered.length,
      byScope,
      byType,
    };
  }

  private getRow(sourceId: string, scopeId: string, analysisType: string): AnalysisRow | undefined {
    const db = getDb(this.config);
    return db.prepare(
      `SELECT * FROM analyses WHERE source_id = ? AND scope_id = ? AND analysis_type = ?`
    ).get(sourceId, scopeId, analysisType) as AnalysisRow | undefined;
  }

  private rowToEntry(row: AnalysisRow): AnalysisEntry {
    return {
      id: row.id,
      sourceId: row.source_id,
      scopeId: row.scope_id,
      analysisType: row.analysis_type,
      content: row.content,
      metadata: {
        model: row.model || undefined,
        timestamp: row.updated_at,
        version: row.version,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        confidence: row.confidence ?? undefined,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
