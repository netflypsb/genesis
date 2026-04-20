import * as fs from 'node:fs';
import * as path from 'node:path';
import type { K01Config } from '../config.js';
import type {
  K01Document,
  DocumentStructure,
  DocumentMetadata,
  DocumentIndex,
} from '../types.js';
import { getDb } from './db.js';

export class DocumentStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  getDocDir(docId: string): string {
    return path.join(this.config.documentsDir, docId);
  }

  createDocument(docId: string): string {
    const docDir = this.getDocDir(docId);
    fs.mkdirSync(docDir, { recursive: true });
    return docDir;
  }

  saveMarkdown(docId: string, markdown: string): string {
    const mdPath = path.join(this.getDocDir(docId), 'content.md');
    fs.writeFileSync(mdPath, markdown, 'utf-8');
    return mdPath;
  }

  loadMarkdown(docId: string): string {
    const mdPath = path.join(this.getDocDir(docId), 'content.md');
    if (!fs.existsSync(mdPath)) {
      throw new Error(`Document content not found: ${docId}`);
    }
    return fs.readFileSync(mdPath, 'utf-8');
  }

  saveStructure(docId: string, structure: DocumentStructure): void {
    const structPath = path.join(this.getDocDir(docId), 'structure.json');
    fs.writeFileSync(structPath, JSON.stringify(structure, null, 2), 'utf-8');
  }

  loadStructure(docId: string): DocumentStructure {
    const structPath = path.join(this.getDocDir(docId), 'structure.json');
    if (!fs.existsSync(structPath)) {
      throw new Error(`Document structure not found: ${docId}`);
    }
    return JSON.parse(fs.readFileSync(structPath, 'utf-8'));
  }

  saveIndex(docId: string, index: DocumentIndex): void {
    const indexPath = path.join(this.getDocDir(docId), 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  loadIndex(docId: string): DocumentIndex {
    const indexPath = path.join(this.getDocDir(docId), 'index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Document index not found: ${docId}`);
    }
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  }

  saveMeta(docId: string, doc: K01Document): void {
    const metaPath = path.join(this.getDocDir(docId), 'source.meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(doc, null, 2), 'utf-8');

    const db = getDb(this.config);
    db.prepare(`
      INSERT OR REPLACE INTO sources (id, type, name, created_at, updated_at)
      VALUES (?, 'document', ?, ?, ?)
    `).run(docId, doc.title, doc.createdAt, doc.updatedAt);
  }

  loadMeta(docId: string): K01Document {
    const metaPath = path.join(this.getDocDir(docId), 'source.meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error(`Document metadata not found: ${docId}`);
    }
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  indexContentForFTS(docId: string, markdown: string): void {
    const db = getDb(this.config);
    const lines = markdown.split('\n');

    // Clear existing FTS entries for this document
    db.prepare(`DELETE FROM document_fts WHERE source_id = ?`).run(docId);

    const insert = db.prepare(
      `INSERT INTO document_fts (source_id, line_number, content) VALUES (?, ?, ?)`
    );

    const batch = db.transaction((lines: string[]) => {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length > 0) {
          insert.run(docId, i, line);
        }
      }
    });

    batch(lines);
  }

  listDocuments(): string[] {
    if (!fs.existsSync(this.config.documentsDir)) return [];
    return fs.readdirSync(this.config.documentsDir).filter((name: string) => {
      const metaPath = path.join(this.config.documentsDir, name, 'source.meta.json');
      return fs.existsSync(metaPath);
    });
  }

  deleteDocument(docId: string): boolean {
    const docDir = this.getDocDir(docId);
    if (!fs.existsSync(docDir)) return false;

    fs.rmSync(docDir, { recursive: true, force: true });

    const db = getDb(this.config);
    db.prepare(`DELETE FROM document_fts WHERE source_id = ?`).run(docId);
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(docId);

    return true;
  }

  exists(docId: string): boolean {
    return fs.existsSync(path.join(this.getDocDir(docId), 'source.meta.json'));
  }
}
