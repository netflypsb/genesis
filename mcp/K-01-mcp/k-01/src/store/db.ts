import Database from 'better-sqlite3';
import type { K01Config } from '../config.js';

let _db: Database.Database | null = null;

export function getDb(config: K01Config): Database.Database {
  if (_db) return _db;

  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Full-text search for document content
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      source_id,
      line_number,
      content,
      tokenize='porter unicode61'
    );

    -- Full-text search for project files
    CREATE VIRTUAL TABLE IF NOT EXISTS project_fts USING fts5(
      source_id,
      file_path,
      line_number,
      content,
      tokenize='porter unicode61'
    );

    -- Source registry (both documents and projects)
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('document', 'project')),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Phase 2: Analysis tracking
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      version INTEGER DEFAULT 1,
      tags TEXT,
      confidence REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_id, scope_id, analysis_type)
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_source ON analyses(source_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_type ON analyses(analysis_type);

    -- Phase 2: Session tracking
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      completed_sections TEXT,
      current_section TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source_id);

    -- Phase 3: Embedding storage for semantic search
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_id);

    -- Phase 4: Knowledge Graph
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      properties TEXT,
      locations TEXT,
      community_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entities_source ON entities(source_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_entities_community ON entities(community_id);

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      weight REAL DEFAULT 1.0,
      properties TEXT,
      source_location TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_entity_id) REFERENCES entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES entities(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);

    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      level INTEGER DEFAULT 0,
      title TEXT,
      summary TEXT,
      entity_count INTEGER,
      parent_community_id TEXT,
      created_at TEXT NOT NULL
    );

    -- Phase 5: Recursive Analysis
    CREATE TABLE IF NOT EXISTS analysis_plans (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT DEFAULT 'planned',
      total_tasks INTEGER,
      completed_tasks INTEGER DEFAULT 0,
      plan_tree TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plans_source ON analysis_plans(source_id);

    CREATE TABLE IF NOT EXISTS summary_nodes (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      title TEXT,
      summary TEXT NOT NULL,
      child_ids TEXT,
      parent_id TEXT,
      confidence REAL,
      word_count INTEGER,
      summary_word_count INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_summary_source_level ON summary_nodes(source_id, level);

    -- Phase 6: Collections
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_ids TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
