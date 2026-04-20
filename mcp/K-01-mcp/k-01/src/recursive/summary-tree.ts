import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import type { SummaryNode, HierarchicalSummary, SummaryLevel } from '../types.js';
import { getDb } from '../store/db.js';

interface SummaryRow {
  id: string;
  source_id: string;
  scope_id: string;
  level: number;
  title: string | null;
  summary: string;
  child_ids: string | null;
  parent_id: string | null;
  confidence: number | null;
  word_count: number | null;
  summary_word_count: number | null;
  created_at: string;
}

export class SummaryTree {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  saveSummaryNode(
    sourceId: string,
    scopeId: string,
    level: number,
    title: string,
    summary: string,
    childIds: string[],
    parentId?: string,
    confidence?: number,
    wordCount?: number,
  ): string {
    const db = getDb(this.config);
    const id = uuidv4();
    const now = new Date().toISOString();
    const summaryWordCount = summary.split(/\s+/).length;

    db.prepare(`
      INSERT INTO summary_nodes (id, source_id, scope_id, level, title, summary, child_ids, parent_id, confidence, word_count, summary_word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sourceId, scopeId, level, title, summary,
      JSON.stringify(childIds),
      parentId || null,
      confidence ?? null,
      wordCount ?? null,
      summaryWordCount,
      now,
    );

    return id;
  }

  getSummaryTree(sourceId: string): HierarchicalSummary {
    const db = getDb(this.config);
    const rows = db.prepare(
      `SELECT * FROM summary_nodes WHERE source_id = ? ORDER BY level ASC`
    ).all(sourceId) as SummaryRow[];

    // Group by level
    const levelMap = new Map<number, SummaryNode[]>();
    for (const row of rows) {
      const node = this.rowToNode(row);
      if (!levelMap.has(row.level)) levelMap.set(row.level, []);
      levelMap.get(row.level)!.push(node);
    }

    const levels: SummaryLevel[] = [...levelMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, nodes]) => ({ level, nodes }));

    return {
      sourceId,
      levels,
      totalLevels: levels.length,
      createdAt: rows[0]?.created_at || new Date().toISOString(),
    };
  }

  getNodesAtLevel(sourceId: string, level: number): SummaryNode[] {
    const db = getDb(this.config);
    const rows = db.prepare(
      `SELECT * FROM summary_nodes WHERE source_id = ? AND level = ? ORDER BY scope_id`
    ).all(sourceId, level) as SummaryRow[];

    return rows.map((r) => this.rowToNode(r));
  }

  queryAtLevel(sourceId: string, query: string, level?: number): SummaryNode[] {
    const db = getDb(this.config);
    const lowerQuery = `%${query.toLowerCase()}%`;

    let sql: string;
    const params: any[] = [sourceId, lowerQuery, lowerQuery];

    if (level !== undefined) {
      sql = `SELECT * FROM summary_nodes WHERE source_id = ? AND level = ? AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ?) ORDER BY level ASC`;
      params.splice(1, 0, level);
    } else {
      sql = `SELECT * FROM summary_nodes WHERE source_id = ? AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ?) ORDER BY level ASC`;
    }

    const rows = db.prepare(sql).all(...params) as SummaryRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  getMaxLevel(sourceId: string): number {
    const db = getDb(this.config);
    const row = db.prepare(
      `SELECT MAX(level) as maxLevel FROM summary_nodes WHERE source_id = ?`
    ).get(sourceId) as { maxLevel: number | null };
    return row.maxLevel ?? -1;
  }

  deleteForSource(sourceId: string): void {
    const db = getDb(this.config);
    db.prepare(`DELETE FROM summary_nodes WHERE source_id = ?`).run(sourceId);
  }

  private rowToNode(row: SummaryRow): SummaryNode {
    const wordCount = row.word_count || 0;
    const summaryWordCount = row.summary_word_count || 1;
    return {
      id: row.id,
      scopeId: row.scope_id,
      title: row.title || '',
      summary: row.summary,
      childIds: row.child_ids ? JSON.parse(row.child_ids) : [],
      parentId: row.parent_id || undefined,
      confidence: row.confidence ?? 1.0,
      wordCount,
      summaryWordCount,
      compressionRatio: wordCount > 0 ? wordCount / summaryWordCount : 1,
    };
  }
}
