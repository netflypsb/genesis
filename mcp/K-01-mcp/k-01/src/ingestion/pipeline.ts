import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import { detectLanguage, DEFAULT_EXCLUDE_PATTERNS, MAX_FILE_SIZE } from '../config.js';
import type {
  K01Document,
  K01Project,
  DocumentSourceType,
  IngestDocumentOptions,
  IngestProjectOptions,
  FileTreeNode,
  SymbolNode,
} from '../types.js';
import { DocumentStore } from '../store/document-store.js';
import { ProjectStore } from '../store/project-store.js';
import { DocumentStructureExtractor } from './structure/document-extractor.js';
import { CodeSymbolExtractor } from './structure/code-extractor.js';
import { parseTextFile } from './parsers/text.js';
import { parseDocxFile } from './parsers/docx.js';
import { parsePdfFile } from './parsers/pdf.js';
import { parseCodeFile } from './parsers/code.js';

const SUPPORTED_DOC_EXTENSIONS: Record<string, DocumentSourceType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.mdx': 'md',
  '.html': 'html',
  '.htm': 'html',
};

export class IngestionPipeline {
  private docStore: DocumentStore;
  private projectStore: ProjectStore;
  private structExtractor: DocumentStructureExtractor;
  private codeExtractor: CodeSymbolExtractor;

  constructor(
    config: K01Config,
    docStore: DocumentStore,
    projectStore: ProjectStore,
  ) {
    this.docStore = docStore;
    this.projectStore = projectStore;
    this.structExtractor = new DocumentStructureExtractor();
    this.codeExtractor = new CodeSymbolExtractor();
  }

  async ingestDocument(options: IngestDocumentOptions): Promise<K01Document> {
    const { filePath, title } = options;

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const sourceType = SUPPORTED_DOC_EXTENSIONS[ext];
    if (!sourceType) {
      throw new Error(`Unsupported file type: ${ext}. Supported: ${Object.keys(SUPPORTED_DOC_EXTENSIONS).join(', ')}`);
    }

    const docId = uuidv4();
    const now = new Date().toISOString();

    // Create storage directory
    this.docStore.createDocument(docId);

    // Parse document to markdown
    let result;
    switch (sourceType) {
      case 'pdf':
        result = await parsePdfFile(filePath);
        break;
      case 'docx':
        result = await parseDocxFile(filePath);
        break;
      default:
        result = parseTextFile(filePath);
        break;
    }

    let markdown = result.markdown;

    // Prepend title if provided and no H1 exists
    if (title && !markdown.match(/^#\s+/m)) {
      markdown = `# ${title}\n\n${markdown}`;
    }

    // Save markdown
    const contentPath = this.docStore.saveMarkdown(docId, markdown);

    // Extract structure
    const structure = this.structExtractor.extract(markdown);

    // Override title if provided
    if (title) structure.title = title;

    // Save structure
    this.docStore.saveStructure(docId, structure);

    // Build and save index
    const index = this.structExtractor.buildIndex(structure);
    this.docStore.saveIndex(docId, index);

    // Index for full-text search
    this.docStore.indexContentForFTS(docId, markdown);

    // Compute stats
    const lines = markdown.split('\n');
    const totalWords = lines.join(' ').split(/\s+/).filter((w) => w.length > 0).length;

    // Build document object
    const doc: K01Document = {
      id: docId,
      title: structure.title,
      sourcePath: filePath,
      sourceType,
      contentPath,
      totalLines: lines.length,
      totalWords,
      metadata: {
        title: title || result.metadata.title,
        fileType: sourceType,
        fileSize: stats.size,
        originalPath: filePath,
        pages: result.metadata.pages,
        author: result.metadata.author,
        date: result.metadata.date,
      },
      structure,
      createdAt: now,
      updatedAt: now,
    };

    // Save metadata
    this.docStore.saveMeta(docId, doc);

    return doc;
  }

  async ingestProject(options: IngestProjectOptions): Promise<K01Project> {
    const { rootPath, name, excludePatterns } = options;

    if (!fs.existsSync(rootPath)) {
      throw new Error(`Directory not found: ${rootPath}`);
    }

    const stats = fs.statSync(rootPath);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${rootPath}`);
    }

    const projectId = uuidv4();
    const now = new Date().toISOString();

    this.projectStore.createProject(projectId);

    // Build exclusion set
    const excludes = new Set([
      ...DEFAULT_EXCLUDE_PATTERNS,
      ...(excludePatterns || []),
    ]);

    // Load .gitignore patterns if present
    const gitignorePath = path.join(rootPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      for (const line of gitignore.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          excludes.add(trimmed.replace(/\//g, ''));
        }
      }
    }

    // Walk directory tree
    const fileTree = this.buildFileTree(rootPath, rootPath, excludes);
    const allSymbols: SymbolNode[] = [];
    const languages: Record<string, number> = {};
    let totalFiles = 0;
    let totalLines = 0;

    // Process each file
    this.walkTree(fileTree, (node) => {
      if (node.type !== 'file') return;
      totalFiles++;

      if (node.language) {
        languages[node.language] = (languages[node.language] || 0) + 1;
      }

      // Read and index file content
      const fullPath = path.join(rootPath, node.path);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lineCount = content.split('\n').length;
        node.lineCount = lineCount;
        totalLines += lineCount;

        // Index for FTS
        this.projectStore.indexFileForFTS(projectId, node.path, content);

        // Extract symbols
        if (node.language) {
          const symbols = this.codeExtractor.extractSymbols(content, node.path, node.language);
          allSymbols.push(...symbols);
        }
      } catch {
        // Skip files that can't be read (binary, permission denied, etc.)
      }
    });

    const projectStructure = {
      fileTree,
      symbols: allSymbols,
      totalSymbols: allSymbols.length,
    };

    this.projectStore.saveStructure(projectId, projectStructure);

    const project: K01Project = {
      id: projectId,
      name: name || path.basename(rootPath),
      rootPath,
      totalFiles,
      totalLines,
      languages,
      structure: projectStructure,
      createdAt: now,
      updatedAt: now,
    };

    this.projectStore.saveMeta(projectId, project);

    return project;
  }

  private buildFileTree(
    currentPath: string,
    rootPath: string,
    excludes: Set<string>,
  ): FileTreeNode[] {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    for (const entry of entries) {
      if (excludes.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const children = this.buildFileTree(fullPath, rootPath, excludes);
        if (children.length > 0) {
          nodes.push({
            path: relativePath,
            type: 'directory',
            children,
          });
        }
      } else if (entry.isFile()) {
        const stats = fs.statSync(fullPath);
        // Skip binary/large files
        if (stats.size > 1_000_000) continue; // Skip files > 1MB

        const language = detectLanguage(entry.name);
        nodes.push({
          path: relativePath,
          type: 'file',
          language,
          size: stats.size,
        });
      }
    }

    // Sort: directories first, then files, alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  private walkTree(nodes: FileTreeNode[], callback: (node: FileTreeNode) => void): void {
    for (const node of nodes) {
      callback(node);
      if (node.children) {
        this.walkTree(node.children, callback);
      }
    }
  }
}
