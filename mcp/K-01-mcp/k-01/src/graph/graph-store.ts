import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import type { GraphEntity, GraphRelationship, GraphCommunity, EntityLocation } from '../types.js';
import { getDb } from '../store/db.js';

interface EntityRow {
  id: string;
  source_id: string;
  name: string;
  type: string;
  description: string | null;
  properties: string | null;
  locations: string | null;
  community_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RelRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  type: string;
  description: string | null;
  weight: number;
  properties: string | null;
  source_location: string | null;
  created_at: string;
}

interface CommunityRow {
  id: string;
  source_id: string | null;
  level: number;
  title: string | null;
  summary: string | null;
  entity_count: number;
  parent_community_id: string | null;
  created_at: string;
}

export class GraphStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  // ─── Entities ──────────────────────────────────────

  saveEntity(sourceId: string, name: string, type: string, description?: string, properties?: Record<string, any>, locations?: EntityLocation[]): string {
    const db = getDb(this.config);
    const now = new Date().toISOString();

    // Check for existing entity with same name+type+source
    const existing = db.prepare(
      `SELECT id FROM entities WHERE source_id = ? AND name = ? AND type = ?`
    ).get(sourceId, name, type) as { id: string } | undefined;

    if (existing) {
      // Update
      db.prepare(`
        UPDATE entities SET description = COALESCE(?, description), properties = COALESCE(?, properties),
        locations = COALESCE(?, locations), updated_at = ? WHERE id = ?
      `).run(
        description || null,
        properties ? JSON.stringify(properties) : null,
        locations ? JSON.stringify(locations) : null,
        now,
        existing.id,
      );
      return existing.id;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO entities (id, source_id, name, type, description, properties, locations, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sourceId, name, type,
      description || null,
      properties ? JSON.stringify(properties) : null,
      locations ? JSON.stringify(locations) : null,
      now, now,
    );
    return id;
  }

  getEntity(id: string): GraphEntity | null {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as EntityRow | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  getEntities(opts: {
    sourceId?: string;
    type?: string;
    communityId?: string;
    name?: string;
    limit?: number;
  }): GraphEntity[] {
    const db = getDb(this.config);
    let query = `SELECT * FROM entities WHERE 1=1`;
    const params: any[] = [];

    if (opts.sourceId) { query += ` AND source_id = ?`; params.push(opts.sourceId); }
    if (opts.type) { query += ` AND type = ?`; params.push(opts.type); }
    if (opts.communityId) { query += ` AND community_id = ?`; params.push(opts.communityId); }
    if (opts.name) { query += ` AND name LIKE ?`; params.push(`%${opts.name}%`); }

    query += ` ORDER BY name`;
    if (opts.limit) { query += ` LIMIT ?`; params.push(opts.limit); }

    return (db.prepare(query).all(...params) as EntityRow[]).map((r) => this.rowToEntity(r));
  }

  deleteEntitiesForSource(sourceId: string): number {
    const db = getDb(this.config);
    // Delete relationships first
    db.prepare(`
      DELETE FROM relationships WHERE source_entity_id IN (SELECT id FROM entities WHERE source_id = ?)
      OR target_entity_id IN (SELECT id FROM entities WHERE source_id = ?)
    `).run(sourceId, sourceId);
    // Delete communities
    db.prepare(`DELETE FROM communities WHERE source_id = ?`).run(sourceId);
    // Delete entities
    const result = db.prepare(`DELETE FROM entities WHERE source_id = ?`).run(sourceId);
    return result.changes;
  }

  countEntities(sourceId: string): number {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM entities WHERE source_id = ?`).get(sourceId) as { cnt: number };
    return row.cnt;
  }

  getEntityStats(sourceId: string): Record<string, number> {
    const db = getDb(this.config);
    const rows = db.prepare(
      `SELECT type, COUNT(*) as cnt FROM entities WHERE source_id = ? GROUP BY type`
    ).all(sourceId) as { type: string; cnt: number }[];

    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.type] = r.cnt;
    return stats;
  }

  searchEntities(query: string, opts?: { sourceId?: string; entityTypes?: string[]; limit?: number }): GraphEntity[] {
    const db = getDb(this.config);
    const lowerQuery = `%${query.toLowerCase()}%`;
    let sql = `SELECT * FROM entities WHERE (LOWER(name) LIKE ? OR LOWER(description) LIKE ?)`;
    const params: any[] = [lowerQuery, lowerQuery];

    if (opts?.sourceId) {
      sql += ` AND source_id = ?`;
      params.push(opts.sourceId);
    }

    if (opts?.entityTypes && opts.entityTypes.length > 0) {
      const placeholders = opts.entityTypes.map(() => '?').join(',');
      sql += ` AND type IN (${placeholders})`;
      params.push(...opts.entityTypes);
    }

    sql += ` ORDER BY name`;
    if (opts?.limit) { sql += ` LIMIT ?`; params.push(opts.limit); }

    return (db.prepare(sql).all(...params) as EntityRow[]).map((r) => this.rowToEntity(r));
  }

  // ─── Relationships ─────────────────────────────────

  saveRelationship(
    sourceEntityId: string,
    targetEntityId: string,
    type: string,
    description?: string,
    weight?: number,
    properties?: Record<string, any>,
    sourceLocation?: { sourceId: string; scopeId: string; line?: number },
  ): string {
    const db = getDb(this.config);
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO relationships (id, source_entity_id, target_entity_id, type, description, weight, properties, source_location, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sourceEntityId, targetEntityId, type,
      description || null,
      weight ?? 1.0,
      properties ? JSON.stringify(properties) : null,
      sourceLocation ? JSON.stringify(sourceLocation) : null,
      now,
    );
    return id;
  }

  getRelationships(opts: {
    entityId?: string;
    type?: string;
    direction?: 'outgoing' | 'incoming' | 'both';
    limit?: number;
  }): GraphRelationship[] {
    const db = getDb(this.config);
    let query: string;
    const params: any[] = [];
    const direction = opts.direction || 'both';

    if (opts.entityId) {
      if (direction === 'outgoing') {
        query = `SELECT * FROM relationships WHERE source_entity_id = ?`;
        params.push(opts.entityId);
      } else if (direction === 'incoming') {
        query = `SELECT * FROM relationships WHERE target_entity_id = ?`;
        params.push(opts.entityId);
      } else {
        query = `SELECT * FROM relationships WHERE source_entity_id = ? OR target_entity_id = ?`;
        params.push(opts.entityId, opts.entityId);
      }
    } else {
      query = `SELECT * FROM relationships WHERE 1=1`;
    }

    if (opts.type) { query += ` AND type = ?`; params.push(opts.type); }
    if (opts.limit) { query += ` LIMIT ?`; params.push(opts.limit); }

    return (db.prepare(query).all(...params) as RelRow[]).map((r) => this.rowToRelationship(r));
  }

  getRelationshipStats(sourceId: string): Record<string, number> {
    const db = getDb(this.config);
    const rows = db.prepare(`
      SELECT r.type, COUNT(*) as cnt FROM relationships r
      JOIN entities e ON r.source_entity_id = e.id
      WHERE e.source_id = ?
      GROUP BY r.type
    `).all(sourceId) as { type: string; cnt: number }[];

    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.type] = r.cnt;
    return stats;
  }

  // ─── Communities ────────────────────────────────────

  saveCommunity(sourceId: string | null, level: number, title: string, summary: string, entityCount: number, parentId?: string): string {
    const db = getDb(this.config);
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO communities (id, source_id, level, title, summary, entity_count, parent_community_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, level, title, summary, entityCount, parentId || null, now);
    return id;
  }

  getCommunities(opts?: { sourceId?: string; level?: number }): GraphCommunity[] {
    const db = getDb(this.config);
    let query = `SELECT * FROM communities WHERE 1=1`;
    const params: any[] = [];

    if (opts?.sourceId) { query += ` AND source_id = ?`; params.push(opts.sourceId); }
    if (opts?.level !== undefined) { query += ` AND level = ?`; params.push(opts.level); }

    query += ` ORDER BY entity_count DESC`;
    return (db.prepare(query).all(...params) as CommunityRow[]).map((r) => this.rowToCommunity(r));
  }

  getCommunity(id: string): GraphCommunity | null {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT * FROM communities WHERE id = ?`).get(id) as CommunityRow | undefined;
    return row ? this.rowToCommunity(row) : null;
  }

  assignCommunity(entityId: string, communityId: string): void {
    const db = getDb(this.config);
    db.prepare(`UPDATE entities SET community_id = ?, updated_at = ? WHERE id = ?`)
      .run(communityId, new Date().toISOString(), entityId);
  }

  clearCommunities(sourceId: string): void {
    const db = getDb(this.config);
    db.prepare(`UPDATE entities SET community_id = NULL WHERE source_id = ?`).run(sourceId);
    db.prepare(`DELETE FROM communities WHERE source_id = ?`).run(sourceId);
  }

  // ─── Path Finding ──────────────────────────────────

  findPath(fromEntityId: string, toEntityId: string, maxDepth: number = 5): { path: string[]; relationships: GraphRelationship[] } | null {
    const db = getDb(this.config);

    // BFS
    const queue: { entityId: string; path: string[]; rels: GraphRelationship[] }[] = [
      { entityId: fromEntityId, path: [fromEntityId], rels: [] },
    ];
    const visited = new Set<string>([fromEntityId]);

    while (queue.length > 0) {
      const { entityId, path, rels } = queue.shift()!;

      if (path.length > maxDepth + 1) continue;

      // Get all relationships for this entity
      const relRows = db.prepare(
        `SELECT * FROM relationships WHERE source_entity_id = ? OR target_entity_id = ?`
      ).all(entityId, entityId) as RelRow[];

      for (const row of relRows) {
        const rel = this.rowToRelationship(row);
        const neighbor = rel.sourceEntityId === entityId ? rel.targetEntityId : rel.sourceEntityId;

        if (neighbor === toEntityId) {
          return { path: [...path, neighbor], relationships: [...rels, rel] };
        }

        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ entityId: neighbor, path: [...path, neighbor], rels: [...rels, rel] });
        }
      }
    }

    return null;
  }

  // ─── Graph Data for Algorithms ─────────────────────

  getAdjacencyList(sourceId: string): Map<string, Set<string>> {
    const db = getDb(this.config);
    const adj = new Map<string, Set<string>>();

    // Get all entity IDs for this source
    const entityIds = db.prepare(`SELECT id FROM entities WHERE source_id = ?`).all(sourceId) as { id: string }[];
    for (const e of entityIds) {
      adj.set(e.id, new Set());
    }

    // Get all relationships between these entities
    const rels = db.prepare(`
      SELECT r.source_entity_id, r.target_entity_id FROM relationships r
      JOIN entities e1 ON r.source_entity_id = e1.id
      JOIN entities e2 ON r.target_entity_id = e2.id
      WHERE e1.source_id = ? AND e2.source_id = ?
    `).all(sourceId, sourceId) as { source_entity_id: string; target_entity_id: string }[];

    for (const r of rels) {
      adj.get(r.source_entity_id)?.add(r.target_entity_id);
      adj.get(r.target_entity_id)?.add(r.source_entity_id);
    }

    return adj;
  }

  // ─── Row Converters ────────────────────────────────

  private rowToEntity(row: EntityRow): GraphEntity {
    return {
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      type: row.type,
      description: row.description || undefined,
      properties: row.properties ? JSON.parse(row.properties) : undefined,
      locations: row.locations ? JSON.parse(row.locations) : undefined,
      communityId: row.community_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToRelationship(row: RelRow): GraphRelationship {
    return {
      id: row.id,
      sourceEntityId: row.source_entity_id,
      targetEntityId: row.target_entity_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      properties: row.properties ? JSON.parse(row.properties) : undefined,
      sourceLocation: row.source_location ? JSON.parse(row.source_location) : undefined,
      createdAt: row.created_at,
    };
  }

  private rowToCommunity(row: CommunityRow): GraphCommunity {
    return {
      id: row.id,
      sourceId: row.source_id || undefined,
      level: row.level,
      title: row.title || undefined,
      summary: row.summary || undefined,
      entityCount: row.entity_count,
      parentCommunityId: row.parent_community_id || undefined,
      createdAt: row.created_at,
    };
  }
}
