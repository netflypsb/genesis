import * as fs from 'node:fs';
import * as path from 'node:path';
import type { K01Config } from '../config.js';
import { DEFAULT_CONTEXT_LINES, MAX_SEARCH_RESULTS } from '../config.js';
import type { SearchOptions, SearchResult } from '../types.js';
import { DocumentStore } from '../store/document-store.js';
import { ProjectStore } from '../store/project-store.js';
import { DocumentStructureExtractor } from '../ingestion/structure/document-extractor.js';
import { getDb } from '../store/db.js';

export class SearchEngine {
  private config: K01Config;
  private docStore: DocumentStore;
  private projectStore: ProjectStore;
  private structExtractor: DocumentStructureExtractor;

  constructor(
    config: K01Config,
    docStore: DocumentStore,
    projectStore: ProjectStore,
  ) {
    this.config = config;
    this.docStore = docStore;
    this.projectStore = projectStore;
    this.structExtractor = new DocumentStructureExtractor();
  }

  search(options: SearchOptions): SearchResult[] {
    const { id, query, scope, scopeId, caseSensitive, regex, contextLines } = options;
    const ctx = contextLines ?? DEFAULT_CONTEXT_LINES;

    // Determine if this is a document or project
    if (this.docStore.exists(id)) {
      return this.searchDocument(id, query, scope, scopeId, caseSensitive, regex, ctx);
    }
    if (this.projectStore.exists(id)) {
      return this.searchProject(id, query, scopeId, caseSensitive, regex, ctx);
    }

    throw new Error(`Source not found: ${id}. Use k01_list_sources to see available sources.`);
  }

  private searchDocument(
    docId: string,
    query: string,
    scope?: string,
    scopeId?: string,
    caseSensitive?: boolean,
    regex?: boolean,
    contextLines: number = DEFAULT_CONTEXT_LINES,
  ): SearchResult[] {
    const markdown = this.docStore.loadMarkdown(docId);
    const lines = markdown.split('\n');
    const structure = this.docStore.loadStructure(docId);

    // Determine search range
    let startLine = 0;
    let endLine = lines.length - 1;

    if (scope === 'section' && scopeId) {
      const section = this.structExtractor.findSectionById(structure.sections, scopeId);
      if (section) {
        startLine = section.startLine;
        endLine = section.endLine;
      }
    }

    return this.searchLines(lines, query, startLine, endLine, caseSensitive, regex, contextLines, (lineNum) => {
      // Find containing section
      const index = this.docStore.loadIndex(docId);
      return index.lineToSection[lineNum] || undefined;
    });
  }

  private searchProject(
    projectId: string,
    query: string,
    filePath?: string,
    caseSensitive?: boolean,
    regex?: boolean,
    contextLines: number = DEFAULT_CONTEXT_LINES,
  ): SearchResult[] {
    const project = this.projectStore.loadMeta(projectId);
    const results: SearchResult[] = [];

    if (filePath) {
      // Search within a specific file
      const fullPath = path.join(project.rootPath, filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found in project: ${filePath}`);
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      return this.searchLines(lines, query, 0, lines.length - 1, caseSensitive, regex, contextLines, () => undefined, filePath);
    }

    // Search across all files using FTS
    const db = getDb(this.config);
    const ftsResults = db.prepare(
      `SELECT file_path, line_number, content FROM project_fts
       WHERE source_id = ? AND content MATCH ?
       ORDER BY rank
       LIMIT ?`
    ).all(projectId, query, MAX_SEARCH_RESULTS) as Array<{
      file_path: string;
      line_number: number;
      content: string;
    }>;

    for (const row of ftsResults) {
      // Get context from the actual file
      const fullPath = path.join(project.rootPath, row.file_path);
      let context = row.content;

      try {
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        const lines = fileContent.split('\n');
        const lineNum = row.line_number;
        const ctxStart = Math.max(0, lineNum - contextLines);
        const ctxEnd = Math.min(lines.length - 1, lineNum + contextLines);
        context = lines.slice(ctxStart, ctxEnd + 1).join('\n');
      } catch {
        // Use FTS content as fallback
      }

      results.push({
        lineNumber: row.line_number,
        context,
        exactMatch: row.content,
        filePath: row.file_path,
      });
    }

    return results;
  }

  private searchLines(
    lines: string[],
    query: string,
    startLine: number,
    endLine: number,
    caseSensitive?: boolean,
    regex?: boolean,
    contextLines: number = DEFAULT_CONTEXT_LINES,
    getSectionId?: (lineNum: number) => string | undefined,
    filePath?: string,
  ): SearchResult[] {
    const results: SearchResult[] = [];

    let matcher: (line: string) => boolean;

    if (regex) {
      const flags = caseSensitive ? '' : 'i';
      const re = new RegExp(query, flags);
      matcher = (line) => re.test(line);
    } else {
      const searchQuery = caseSensitive ? query : query.toLowerCase();
      matcher = (line) => {
        const target = caseSensitive ? line : line.toLowerCase();
        return target.includes(searchQuery);
      };
    }

    for (let i = startLine; i <= endLine && results.length < MAX_SEARCH_RESULTS; i++) {
      if (matcher(lines[i])) {
        const ctxStart = Math.max(startLine, i - contextLines);
        const ctxEnd = Math.min(endLine, i + contextLines);
        const context = lines.slice(ctxStart, ctxEnd + 1).join('\n');

        results.push({
          lineNumber: i,
          context,
          exactMatch: lines[i],
          sectionId: getSectionId?.(i),
          filePath,
        });
      }
    }

    return results;
  }
}
