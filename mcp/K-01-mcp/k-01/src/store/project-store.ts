import * as fs from 'node:fs';
import * as path from 'node:path';
import type { K01Config } from '../config.js';
import type { K01Project, ProjectStructure } from '../types.js';
import { getDb } from './db.js';

export class ProjectStore {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  getProjectDir(projectId: string): string {
    return path.join(this.config.projectsDir, projectId);
  }

  createProject(projectId: string): string {
    const projectDir = this.getProjectDir(projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    return projectDir;
  }

  saveStructure(projectId: string, structure: ProjectStructure): void {
    const structPath = path.join(this.getProjectDir(projectId), 'structure.json');
    fs.writeFileSync(structPath, JSON.stringify(structure, null, 2), 'utf-8');
  }

  loadStructure(projectId: string): ProjectStructure {
    const structPath = path.join(this.getProjectDir(projectId), 'structure.json');
    if (!fs.existsSync(structPath)) {
      throw new Error(`Project structure not found: ${projectId}`);
    }
    return JSON.parse(fs.readFileSync(structPath, 'utf-8'));
  }

  saveMeta(projectId: string, project: K01Project): void {
    const metaPath = path.join(this.getProjectDir(projectId), 'project.meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(project, null, 2), 'utf-8');

    const db = getDb(this.config);
    db.prepare(`
      INSERT OR REPLACE INTO sources (id, type, name, created_at, updated_at)
      VALUES (?, 'project', ?, ?, ?)
    `).run(projectId, project.name, project.createdAt, project.updatedAt);
  }

  loadMeta(projectId: string): K01Project {
    const metaPath = path.join(this.getProjectDir(projectId), 'project.meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error(`Project metadata not found: ${projectId}`);
    }
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  indexFileForFTS(projectId: string, filePath: string, content: string): void {
    const db = getDb(this.config);
    const lines = content.split('\n');

    db.prepare(`DELETE FROM project_fts WHERE source_id = ? AND file_path = ?`).run(projectId, filePath);

    const insert = db.prepare(
      `INSERT INTO project_fts (source_id, file_path, line_number, content) VALUES (?, ?, ?, ?)`
    );

    const batch = db.transaction((lines: string[]) => {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length > 0) {
          insert.run(projectId, filePath, i, line);
        }
      }
    });

    batch(lines);
  }

  listProjects(): string[] {
    if (!fs.existsSync(this.config.projectsDir)) return [];
    return fs.readdirSync(this.config.projectsDir).filter((name: string) => {
      const metaPath = path.join(this.config.projectsDir, name, 'project.meta.json');
      return fs.existsSync(metaPath);
    });
  }

  deleteProject(projectId: string): boolean {
    const projectDir = this.getProjectDir(projectId);
    if (!fs.existsSync(projectDir)) return false;

    fs.rmSync(projectDir, { recursive: true, force: true });

    const db = getDb(this.config);
    db.prepare(`DELETE FROM project_fts WHERE source_id = ?`).run(projectId);
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(projectId);

    return true;
  }

  exists(projectId: string): boolean {
    return fs.existsSync(path.join(this.getProjectDir(projectId), 'project.meta.json'));
  }
}
