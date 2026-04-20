// K-01 Core Type Definitions

// ─── Document Types ─────────────────────────────────────────────

export interface K01Document {
  id: string;
  title: string;
  sourcePath: string;
  sourceType: DocumentSourceType;
  contentPath: string;
  totalLines: number;
  totalWords: number;
  metadata: DocumentMetadata;
  structure: DocumentStructure;
  createdAt: string;
  updatedAt: string;
}

export type DocumentSourceType = 'pdf' | 'docx' | 'epub' | 'txt' | 'md' | 'html';

export interface DocumentMetadata {
  title?: string;
  author?: string;
  date?: string;
  pages?: number;
  fileType: string;
  fileSize: number;
  originalPath: string;
}

export interface DocumentStructure {
  title: string;
  sections: SectionNode[];
  outline: string;
  totalSections: number;
  maxDepth: number;
}

export interface SectionNode {
  id: string;
  level: number;
  title: string;
  startLine: number;
  endLine: number;
  children: SectionNode[];
  parentId?: string;
  wordCount: number;
}

// ─── Project Types ──────────────────────────────────────────────

export interface K01Project {
  id: string;
  name: string;
  rootPath: string;
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  structure: ProjectStructure;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStructure {
  fileTree: FileTreeNode[];
  symbols: SymbolNode[];
  totalSymbols: number;
}

export interface FileTreeNode {
  path: string;
  type: 'file' | 'directory';
  language?: string;
  size?: number;
  lineCount?: number;
  children?: FileTreeNode[];
}

export interface SymbolNode {
  name: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'variable' | 'export';
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

// ─── Navigation Types ───────────────────────────────────────────

export interface ReadSectionOptions {
  docId: string;
  sectionId: string;
  includeChildren?: boolean;
  maxLines?: number;
}

export interface ReadRangeOptions {
  id: string;
  filePath?: string;
  startLine: number;
  endLine: number;
}

export interface SearchOptions {
  id: string;
  query: string;
  scope?: 'full' | 'section' | 'file';
  scopeId?: string;
  caseSensitive?: boolean;
  regex?: boolean;
  contextLines?: number;
}

export interface SearchResult {
  lineNumber: number;
  context: string;
  exactMatch: string;
  sectionId?: string;
  filePath?: string;
}

// ─── Index Types ────────────────────────────────────────────────

export interface DocumentIndex {
  sectionsById: Record<string, SectionIndexEntry>;
  sectionsByLevel: Record<number, string[]>;
  lineToSection: Record<number, string>;
}

export interface SectionIndexEntry {
  id: string;
  level: number;
  title: string;
  startLine: number;
  endLine: number;
  parentId?: string;
}

// ─── Ingestion Types ────────────────────────────────────────────

export interface ParseResult {
  markdown: string;
  metadata: Partial<DocumentMetadata>;
}

export interface IngestDocumentOptions {
  filePath: string;
  title?: string;
}

export interface IngestProjectOptions {
  rootPath: string;
  name?: string;
  excludePatterns?: string[];
}

// ─── Analysis Types (Phase 2) ───────────────────────────────────

export interface AnalysisEntry {
  id: string;
  sourceId: string;
  scopeId: string;
  analysisType: string;
  content: string;
  metadata: AnalysisMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisMetadata {
  model?: string;
  timestamp: string;
  version: number;
  tags?: string[];
  confidence?: number;
}

export interface AnalysisSession {
  id: string;
  sourceId: string;
  status: 'active' | 'paused' | 'complete';
  progress: SessionProgress;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionProgress {
  totalSections: number;
  completedSections: string[];
  currentSection?: string;
  percentComplete: number;
}

export interface SaveAnalysisOptions {
  sourceId: string;
  scopeId: string;
  analysisType: string;
  content: string;
  tags?: string[];
  confidence?: number;
}

export interface UpdateAnalysisOptions {
  sourceId: string;
  scopeId: string;
  analysisType: string;
  content: string;
  append?: boolean;
}

// ─── Enhanced Code Types (Phase 3) ──────────────────────────────

export interface EnhancedSymbolNode extends SymbolNode {
  parameters?: ParameterNode[];
  returnType?: string;
  decorators?: string[];
  visibility?: 'public' | 'private' | 'protected';
  isAsync?: boolean;
  isStatic?: boolean;
  docstring?: string;
  calls: string[];
  calledBy: string[];
  imports: string[];
}

export interface ParameterNode {
  name: string;
  type?: string;
  defaultValue?: string;
}

export interface CallGraphEdge {
  from: string;
  to: string;
  filePath: string;
  line: number;
}

export interface DependencyEdge {
  fromFile: string;
  toModule: string;
  importNames: string[];
  isRelative: boolean;
}

// ─── Embedding Types (Phase 3) ──────────────────────────────────

export type EmbeddingProvider = 'ollama' | 'openai' | 'none';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions: number;
}

export interface EmbeddingChunk {
  id: string;
  sourceId: string;
  scopeId: string;
  chunkText: string;
  embedding: Float32Array;
  model: string;
  dimensions: number;
  createdAt: string;
}

export interface SemanticSearchResult {
  chunkText: string;
  scopeId: string;
  score: number;
  sourceId: string;
}

// ─── Parser Config Types (Phase 3) ──────────────────────────────

export interface ParserConfig {
  pdf: {
    preferred: 'mineru' | 'marker' | 'basic' | 'auto';
    mineruPath?: string;
    markerPath?: string;
  };
}

// ─── Knowledge Graph Types (Phase 4) ────────────────────────────

export interface GraphEntity {
  id: string;
  sourceId: string;
  name: string;
  type: string;
  description?: string;
  properties?: Record<string, any>;
  locations?: EntityLocation[];
  communityId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityLocation {
  sourceId: string;
  scopeId: string;
  startLine?: number;
  endLine?: number;
}

export interface GraphRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: string;
  description?: string;
  weight: number;
  properties?: Record<string, any>;
  sourceLocation?: { sourceId: string; scopeId: string; line?: number };
  createdAt: string;
}

export interface GraphCommunity {
  id: string;
  sourceId?: string;
  level: number;
  title?: string;
  summary?: string;
  entityCount: number;
  parentCommunityId?: string;
  createdAt: string;
}

export interface ExtractionConfig {
  mode: 'rule-based' | 'llm-enhanced' | 'hybrid';
  llm?: {
    provider: 'ollama' | 'openai' | 'anthropic';
    model: string;
    apiKey?: string;
    baseUrl?: string;
    batchSize: number;
    extractionPrompt?: string;
  };
}

export interface CrossSourceLink {
  entityId1: string;
  entityId2: string;
  linkType: 'same_as' | 'related_to' | 'contradicts' | 'supports' | 'extends';
  confidence: number;
  evidence: string;
}

export interface ExtractedEntity {
  name: string;
  type: string;
  description?: string;
  properties?: Record<string, any>;
  location?: EntityLocation;
}

export interface ExtractedRelationship {
  sourceName: string;
  targetName: string;
  type: string;
  description?: string;
  weight?: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// ─── Recursive Analysis Types (Phase 5) ─────────────────────────

export interface RecursiveAnalysisPlan {
  id: string;
  sourceId: string;
  rootTaskId: string;
  totalTasks: number;
  completedTasks: number;
  status: 'planned' | 'in_progress' | 'complete';
  tree: AnalysisTaskNode;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisTaskNode {
  id: string;
  type: 'leaf' | 'synthesis';
  scopeId: string;
  scopeDescription: string;
  status: 'pending' | 'in_progress' | 'complete' | 'skipped';
  depth: number;
  children: AnalysisTaskNode[];
  analysisId?: string;
  wordCount: number;
  estimatedTokens: number;
  confidence?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface HierarchicalSummary {
  sourceId: string;
  levels: SummaryLevel[];
  totalLevels: number;
  createdAt: string;
}

export interface SummaryLevel {
  level: number;
  nodes: SummaryNode[];
}

export interface SummaryNode {
  id: string;
  scopeId: string;
  title: string;
  summary: string;
  childIds: string[];
  parentId?: string;
  confidence: number;
  wordCount: number;
  summaryWordCount: number;
  compressionRatio: number;
}

// ─── Synthesis & Export Types (Phase 6) ──────────────────────────

export interface SourceCollection {
  id: string;
  name: string;
  description?: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportedKnowledge {
  source: K01Document | K01Project;
  structure: DocumentStructure | ProjectStructure;
  analyses: AnalysisEntry[];
  summaryTree: HierarchicalSummary | null;
  graph: {
    entities: GraphEntity[];
    relationships: GraphRelationship[];
    communities: GraphCommunity[];
  };
  crossLinks?: CrossSourceLink[];
  exportedAt: string;
}

// ─── Source Union ────────────────────────────────────────────────

export type K01Source = K01Document | K01Project;

export function isDocument(source: K01Source): source is K01Document {
  return 'sourceType' in source;
}

export function isProject(source: K01Source): source is K01Project {
  return 'rootPath' in source && !('sourceType' in source);
}
