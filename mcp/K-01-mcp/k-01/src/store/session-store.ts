import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import type { AnalysisSession, SessionProgress } from '../types.js';
import { getDb } from './db.js';

interface SessionRow {
  id: string;
  source_id: string;
  status: string;
  completed_sections: string | null;
  current_section: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class SessionStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  startOrResume(sourceId: string, totalSections: number, notes?: string): AnalysisSession {
    const db = getDb(this.config);

    // Check for existing active/paused session for this source
    const existing = db.prepare(
      `SELECT * FROM sessions WHERE source_id = ? AND status IN ('active', 'paused') ORDER BY updated_at DESC LIMIT 1`
    ).get(sourceId) as SessionRow | undefined;

    if (existing) {
      // Resume — update status to active
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE sessions SET status = 'active', updated_at = ? WHERE id = ?`
      ).run(now, existing.id);

      const completedSections: string[] = existing.completed_sections
        ? JSON.parse(existing.completed_sections)
        : [];

      return {
        id: existing.id,
        sourceId: existing.source_id,
        status: 'active',
        progress: {
          totalSections,
          completedSections,
          currentSection: existing.current_section || undefined,
          percentComplete: totalSections > 0 ? Math.round((completedSections.length / totalSections) * 100) : 0,
        },
        notes: existing.notes || '',
        createdAt: existing.created_at,
        updatedAt: now,
      };
    }

    // Create new session
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO sessions (id, source_id, status, completed_sections, notes, created_at, updated_at)
      VALUES (?, ?, 'active', '[]', ?, ?, ?)
    `).run(id, sourceId, notes || '', now, now);

    return {
      id,
      sourceId,
      status: 'active',
      progress: {
        totalSections,
        completedSections: [],
        percentComplete: 0,
      },
      notes: notes || '',
      createdAt: now,
      updatedAt: now,
    };
  }

  getProgress(sessionId: string, totalSections?: number): AnalysisSession {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;

    if (!row) {
      throw new Error(`Session not found: ${sessionId}. Use k01_start_session to create one.`);
    }

    return this.rowToSession(row, totalSections);
  }

  update(
    sessionId: string,
    options: {
      completedSection?: string;
      notes?: string;
      status?: 'active' | 'paused' | 'complete';
    },
    totalSections?: number,
  ): AnalysisSession {
    const db = getDb(this.config);
    const now = new Date().toISOString();

    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let completedSections: string[] = row.completed_sections ? JSON.parse(row.completed_sections) : [];

    // Mark section complete
    if (options.completedSection && !completedSections.includes(options.completedSection)) {
      completedSections.push(options.completedSection);
    }

    const newStatus = options.status || row.status;
    const newNotes = options.notes !== undefined ? options.notes : (row.notes || '');
    const currentSection = options.completedSection || row.current_section;

    db.prepare(`
      UPDATE sessions SET
        status = ?,
        completed_sections = ?,
        current_section = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      newStatus,
      JSON.stringify(completedSections),
      currentSection,
      newNotes,
      now,
      sessionId,
    );

    const updated = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow;
    return this.rowToSession(updated, totalSections);
  }

  getBySource(sourceId: string): AnalysisSession | null {
    const db = getDb(this.config);
    const row = db.prepare(
      `SELECT * FROM sessions WHERE source_id = ? ORDER BY updated_at DESC LIMIT 1`
    ).get(sourceId) as SessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  deleteForSource(sourceId: string): number {
    const db = getDb(this.config);
    const result = db.prepare(`DELETE FROM sessions WHERE source_id = ?`).run(sourceId);
    return result.changes;
  }

  private rowToSession(row: SessionRow, totalSections?: number): AnalysisSession {
    const completedSections: string[] = row.completed_sections
      ? JSON.parse(row.completed_sections)
      : [];

    const total = totalSections || Math.max(completedSections.length, 1);
    const percentComplete = total > 0 ? Math.round((completedSections.length / total) * 100) : 0;

    return {
      id: row.id,
      sourceId: row.source_id,
      status: row.status as 'active' | 'paused' | 'complete',
      progress: {
        totalSections: total,
        completedSections,
        currentSection: row.current_section || undefined,
        percentComplete,
      },
      notes: row.notes || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
