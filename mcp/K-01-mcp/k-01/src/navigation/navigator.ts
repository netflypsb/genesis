import * as fs from 'node:fs';
import * as path from 'node:path';
import type { K01Config } from '../config.js';
import { MAX_RANGE_LINES } from '../config.js';
import type {
  ReadSectionOptions,
  ReadRangeOptions,
  SectionNode,
  DocumentStructure,
} from '../types.js';
import { DocumentStore } from '../store/document-store.js';
import { ProjectStore } from '../store/project-store.js';
import { DocumentStructureExtractor } from '../ingestion/structure/document-extractor.js';

export class Navigator {
  private docStore: DocumentStore;
  private projectStore: ProjectStore;
  private structExtractor: DocumentStructureExtractor;

  constructor(
    config: K01Config,
    docStore: DocumentStore,
    projectStore: ProjectStore,
  ) {
    this.docStore = docStore;
    this.projectStore = projectStore;
    this.structExtractor = new DocumentStructureExtractor();
  }

  readSection(options: ReadSectionOptions): string {
    const { docId, sectionId, includeChildren, maxLines } = options;

    const structure = this.docStore.loadStructure(docId);
    const section = this.structExtractor.findSectionById(structure.sections, sectionId);

    if (!section) {
      throw new Error(`Section not found: ${sectionId}. Use k01_get_structure to see available sections.`);
    }

    const markdown = this.docStore.loadMarkdown(docId);
    const lines = markdown.split('\n');

    let startLine = section.startLine;
    let endLine = section.endLine;

    if (includeChildren && section.children.length > 0) {
      const lastDescendant = this.findLastDescendant(section);
      endLine = lastDescendant.endLine;
    }

    // Clamp to valid range
    startLine = Math.max(0, startLine);
    endLine = Math.min(lines.length - 1, endLine);

    let contentLines = lines.slice(startLine, endLine + 1);

    if (maxLines && contentLines.length > maxLines) {
      contentLines = contentLines.slice(0, maxLines);
      contentLines.push(`\n... (truncated at ${maxLines} lines, section has ${endLine - startLine + 1} total lines)`);
    }

    return contentLines.join('\n');
  }

  readRange(options: ReadRangeOptions): string {
    const { id, filePath, startLine, endLine } = options;

    if (startLine < 0) {
      throw new Error('startLine must be >= 0');
    }
    if (endLine < startLine) {
      throw new Error('endLine must be >= startLine');
    }
    if (endLine - startLine + 1 > MAX_RANGE_LINES) {
      throw new Error(`Range too large. Max ${MAX_RANGE_LINES} lines per request.`);
    }

    let content: string;

    if (filePath) {
      // Project file read
      const project = this.projectStore.loadMeta(id);
      const fullPath = path.join(project.rootPath, filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found in project: ${filePath}`);
      }
      content = fs.readFileSync(fullPath, 'utf-8');
    } else {
      // Document read
      content = this.docStore.loadMarkdown(id);
    }

    const lines = content.split('\n');
    const clampedEnd = Math.min(endLine, lines.length - 1);
    const slice = lines.slice(startLine, clampedEnd + 1);

    // Add line numbers
    const numbered = slice.map((line: string, i: number) => `${startLine + i}: ${line}`);
    return `Lines ${startLine}-${clampedEnd}:\n\n${numbered.join('\n')}`;
  }

  readProjectFile(projectId: string, filePath: string): string {
    const project = this.projectStore.loadMeta(projectId);
    const fullPath = path.join(project.rootPath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}. Use k01_get_structure to see available files.`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Add line numbers
    const numbered = lines.map((line, i) => `${i}: ${line}`);
    return numbered.join('\n');
  }

  getStructure(id: string, depth?: number): string {
    // Try as document first
    if (this.docStore.exists(id)) {
      const structure = this.docStore.loadStructure(id);
      if (depth) {
        return JSON.stringify(this.trimStructureDepth(structure, depth), null, 2);
      }
      return JSON.stringify(structure, null, 2);
    }

    // Try as project
    if (this.projectStore.exists(id)) {
      const structure = this.projectStore.loadStructure(id);
      if (depth) {
        return JSON.stringify({
          ...structure,
          fileTree: this.trimTreeDepth(structure.fileTree, depth),
        }, null, 2);
      }
      return JSON.stringify(structure, null, 2);
    }

    throw new Error(`Source not found: ${id}. Use k01_list_sources to see available sources.`);
  }

  private findLastDescendant(section: SectionNode): SectionNode {
    if (section.children.length === 0) return section;
    return this.findLastDescendant(section.children[section.children.length - 1]);
  }

  private trimStructureDepth(structure: DocumentStructure, maxDepth: number): DocumentStructure {
    return {
      ...structure,
      sections: this.trimSectionsDepth(structure.sections, 1, maxDepth),
    };
  }

  private trimSectionsDepth(sections: SectionNode[], currentDepth: number, maxDepth: number): SectionNode[] {
    return sections.map((s) => ({
      ...s,
      children: currentDepth < maxDepth
        ? this.trimSectionsDepth(s.children, currentDepth + 1, maxDepth)
        : [],
    }));
  }

  private trimTreeDepth(nodes: any[], depth: number, current: number = 1): any[] {
    if (current >= depth) {
      return nodes.map((n) => ({ ...n, children: undefined }));
    }
    return nodes.map((n) => ({
      ...n,
      children: n.children ? this.trimTreeDepth(n.children, depth, current + 1) : undefined,
    }));
  }
}
