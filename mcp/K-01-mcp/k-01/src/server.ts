#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig, ensureDirectories } from './config.js';
import { DocumentStore } from './store/document-store.js';
import { ProjectStore } from './store/project-store.js';
import { IngestionPipeline } from './ingestion/pipeline.js';
import { Navigator } from './navigation/navigator.js';
import { SearchEngine } from './navigation/search.js';
import { closeDb } from './store/db.js';
import { AnalysisStore } from './store/analysis-store.js';
import { SessionStore } from './store/session-store.js';
import { EmbeddingStore } from './store/embedding-store.js';
import { EmbeddingProvider, chunkText } from './search/embedding-provider.js';
import { CodeSymbolExtractor } from './ingestion/structure/code-extractor.js';
import { detectPdfParsers } from './ingestion/parsers/pdf.js';
import { isTreeSitterLanguage, getSupportedLanguages } from './code/language-registry.js';
import { GraphStore } from './graph/graph-store.js';
import { GraphBuilder } from './graph/graph-builder.js';
import { CrossSourceLinker } from './graph/cross-source-linker.js';
import { buildAnalysisPlan } from './recursive/plan-generator.js';
import { TaskManager } from './recursive/task-manager.js';
import { SummaryTree } from './recursive/summary-tree.js';
import type { AnalysisTaskNode } from './types.js';
import { CollectionStore } from './synthesis/collection-store.js';
import { CrossSearch } from './synthesis/cross-search.js';
import { ReportExporter } from './export/report-exporter.js';

// ─── Initialise ──────────────────────────────────────────────────

const config = getConfig();
ensureDirectories(config);

const docStore = new DocumentStore(config);
const projectStore = new ProjectStore(config);
const pipeline = new IngestionPipeline(config, docStore, projectStore);
const navigator = new Navigator(config, docStore, projectStore);
const searchEngine = new SearchEngine(config, docStore, projectStore);
const analysisStore = new AnalysisStore(config);
const sessionStore = new SessionStore(config);
const embeddingStore = new EmbeddingStore(config);
const embeddingProvider = new EmbeddingProvider(config);
const codeExtractor = new CodeSymbolExtractor();
const graphStore = new GraphStore(config);
const graphBuilder = new GraphBuilder(config, graphStore, docStore, projectStore);
const crossSourceLinker = new CrossSourceLinker(graphStore);
const taskManager = new TaskManager(config, analysisStore);
const summaryTree = new SummaryTree(config);
const collectionStore = new CollectionStore(config);
const crossSearch = new CrossSearch(graphStore, analysisStore);
const reportExporter = new ReportExporter(config, docStore, projectStore, analysisStore, graphStore, summaryTree);

// Init Tree-sitter (async, non-blocking — regex fallback if not ready)
codeExtractor.initTreeSitter(config).then((ok) => {
  if (ok) console.error('Tree-sitter initialized');
  else console.error('Tree-sitter not available — using regex fallback');
});

// ─── MCP Server ──────────────────────────────────────────────────

const server = new Server(
  { name: 'k-01', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  },
);

// ─── Tools ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'k01_ingest_document',
    description: 'Ingest a document file (PDF, DOCX, TXT, MD, HTML) into K-01 for structured navigation and analysis. Returns a document ID used for all subsequent operations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the document file' },
        title: { type: 'string', description: 'Optional title override for the document' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'k01_ingest_project',
    description: 'Ingest a codebase/project directory into K-01. Builds a file tree, extracts symbols, and indexes all source files for navigation and search. Returns a project ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rootPath: { type: 'string', description: 'Absolute path to the project root directory' },
        name: { type: 'string', description: 'Optional project name (defaults to directory name)' },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional directory/file names to exclude (node_modules, .git etc. are excluded by default)',
        },
      },
      required: ['rootPath'],
    },
  },
  {
    name: 'k01_get_structure',
    description: 'Get the hierarchical structure of a document (sections/chapters) or project (file tree + symbols). Use this first to understand the layout before reading content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Document or project ID' },
        depth: { type: 'number', description: 'Max depth level to return (1=top-level only, higher=more detail)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'k01_read_section',
    description: 'Read a specific section of a document by its section ID (obtained from k01_get_structure). Returns the full text content of that section.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        docId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Section ID from the document structure' },
        includeChildren: { type: 'boolean', description: 'Include all child subsections in the output (default: false)' },
        maxLines: { type: 'number', description: 'Maximum number of lines to return (truncates if exceeded)' },
      },
      required: ['docId', 'sectionId'],
    },
  },
  {
    name: 'k01_read_range',
    description: 'Read a specific line range from a document or a file within a project. Lines are 0-indexed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Document or project ID' },
        filePath: { type: 'string', description: 'File path relative to project root (only for projects)' },
        startLine: { type: 'number', description: 'Starting line number (0-indexed, inclusive)' },
        endLine: { type: 'number', description: 'Ending line number (0-indexed, inclusive)' },
      },
      required: ['id', 'startLine', 'endLine'],
    },
  },
  {
    name: 'k01_read_file',
    description: 'Read a specific file from an ingested project. Returns the full file content with line numbers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        filePath: { type: 'string', description: 'File path relative to project root' },
      },
      required: ['projectId', 'filePath'],
    },
  },
  {
    name: 'k01_search',
    description: 'Search for text within a document or project. Supports exact text match, regex, and scoped search within a specific section or file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Document or project ID' },
        query: { type: 'string', description: 'Search query (text or regex pattern)' },
        scope: { type: 'string', enum: ['full', 'section', 'file'], description: 'Search scope (default: full)' },
        scopeId: { type: 'string', description: 'Section ID or file path to scope the search' },
        caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default: false)' },
        regex: { type: 'boolean', description: 'Treat query as regex pattern (default: false)' },
        contextLines: { type: 'number', description: 'Number of context lines around each match (default: 3)' },
      },
      required: ['id', 'query'],
    },
  },
  {
    name: 'k01_list_sources',
    description: 'List all ingested documents and projects with their IDs, names, types, and basic statistics.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'k01_get_info',
    description: 'Get detailed metadata and statistics for an ingested document or project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Document or project ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'k01_delete_source',
    description: 'Delete an ingested document or project and all associated data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Document or project ID to delete' },
      },
      required: ['id'],
    },
  },
  // ── Phase 2: Analysis Tools ─────────────────────
  {
    name: 'k01_save_analysis',
    description: 'Save an analysis for a document section, project file, or full source. If an analysis of the same type already exists for the scope, it is versioned (previous content replaced, version incremented).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        scopeId: { type: 'string', description: 'Section ID, file path, or "full" for source-level analysis' },
        analysisType: { type: 'string', description: 'Type of analysis: summary, themes, critique, notes, architecture, quality, or any custom type' },
        content: { type: 'string', description: 'The analysis content (markdown)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorisation' },
        confidence: { type: 'number', description: 'Optional confidence score 0-1' },
      },
      required: ['sourceId', 'scopeId', 'analysisType', 'content'],
    },
  },
  {
    name: 'k01_get_analysis',
    description: 'Retrieve a previously saved analysis by source, scope, and type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        scopeId: { type: 'string', description: 'Section ID, file path, or "full"' },
        analysisType: { type: 'string', description: 'Type of analysis to retrieve' },
      },
      required: ['sourceId', 'scopeId', 'analysisType'],
    },
  },
  {
    name: 'k01_list_analyses',
    description: 'List all saved analyses for a source, optionally filtered by scope or type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        scopeId: { type: 'string', description: 'Filter by scope (section ID, file path, or "full")' },
        analysisType: { type: 'string', description: 'Filter by analysis type' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'k01_update_analysis',
    description: 'Update an existing analysis. Can replace content entirely or append new content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        scopeId: { type: 'string', description: 'Section ID, file path, or "full"' },
        analysisType: { type: 'string', description: 'Type of analysis to update' },
        content: { type: 'string', description: 'New content (replaces or appends based on append flag)' },
        append: { type: 'boolean', description: 'If true, append to existing content instead of replacing (default: false)' },
      },
      required: ['sourceId', 'scopeId', 'analysisType', 'content'],
    },
  },
  {
    name: 'k01_delete_analysis',
    description: 'Delete a specific analysis entry.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        scopeId: { type: 'string', description: 'Section ID, file path, or "full"' },
        analysisType: { type: 'string', description: 'Type of analysis to delete' },
      },
      required: ['sourceId', 'scopeId', 'analysisType'],
    },
  },
  // ── Phase 2: Session Tools ──────────────────────
  {
    name: 'k01_start_session',
    description: 'Start or resume an analysis session for a source. Returns session ID, progress so far, and existing analyses. If a previous active/paused session exists, it is resumed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID to analyse' },
        notes: { type: 'string', description: 'Optional session notes' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'k01_get_session_progress',
    description: 'Check progress of an analysis session — sections complete, sections remaining, analyses saved.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'k01_update_session',
    description: 'Mark a section as analysed, add session notes, or change session status (active/paused/complete).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        completedSection: { type: 'string', description: 'Section ID to mark as complete' },
        notes: { type: 'string', description: 'Update session notes' },
        status: { type: 'string', enum: ['active', 'paused', 'complete'], description: 'Change session status' },
      },
      required: ['sessionId'],
    },
  },
  // ── Phase 2: Comparison Tools ───────────────────
  {
    name: 'k01_compare_sections',
    description: 'Retrieve multiple sections side-by-side for comparison. Optionally specify aspects to focus the comparison.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document ID' },
        sectionIds: { type: 'array', items: { type: 'string' }, description: 'Array of section IDs to compare' },
        aspects: { type: 'array', items: { type: 'string' }, description: 'Optional aspects to highlight (e.g. "methodology", "conclusions")' },
      },
      required: ['sourceId', 'sectionIds'],
    },
  },
  {
    name: 'k01_get_analysis_summary',
    description: 'Get a bird\'s-eye view of all analysis work done on a source — section-by-section with analysis status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        analysisTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by specific analysis types' },
      },
      required: ['sourceId'],
    },
  },
  // ── Phase 3: Code Intelligence Tools ────────────
  {
    name: 'k01_get_symbols',
    description: 'List symbols (functions, classes, methods, interfaces) in a project or file. Uses Tree-sitter when available, regex fallback otherwise.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        filePath: { type: 'string', description: 'Filter to a specific file path (relative to project root)' },
        kind: { type: 'string', description: 'Filter by symbol kind: function, class, method, interface, variable' },
        name: { type: 'string', description: 'Filter by symbol name (substring match)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'k01_get_call_graph',
    description: 'Get call graph for a symbol — who calls it and what it calls, up to N levels deep. Requires Tree-sitter grammars.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        symbolName: { type: 'string', description: 'Symbol name to trace' },
        direction: { type: 'string', enum: ['callers', 'callees', 'both'], description: 'Direction to trace (default: both)' },
        depth: { type: 'number', description: 'Max depth to trace (default: 2)' },
      },
      required: ['projectId', 'symbolName'],
    },
  },
  {
    name: 'k01_get_dependencies',
    description: 'Get import/dependency relationships for a file in a project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        filePath: { type: 'string', description: 'File path (relative to project root)' },
        direction: { type: 'string', enum: ['imports', 'importedBy', 'both'], description: 'Direction (default: both)' },
      },
      required: ['projectId', 'filePath'],
    },
  },
  {
    name: 'k01_get_impact',
    description: 'Impact analysis — find all files and symbols transitively affected by changes to a given symbol.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        symbolName: { type: 'string', description: 'Symbol name to analyse impact for' },
      },
      required: ['projectId', 'symbolName'],
    },
  },
  // ── Phase 3: Parser Status Tool ─────────────────
  {
    name: 'k01_get_parser_status',
    description: 'Check which parsing engines are installed and active — PDF parsers (MinerU, Marker, pdf-parse), Tree-sitter grammars, and embedding providers.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  // ── Phase 3: Semantic Search Tools ──────────────
  {
    name: 'k01_semantic_search',
    description: 'Find content semantically similar to a query using embeddings. Requires embedding provider to be configured and embeddings to be built for the source.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        query: { type: 'string', description: 'Natural language search query' },
        topK: { type: 'number', description: 'Number of results to return (default: 10)' },
        scope: { type: 'string', description: 'Scope filter (section ID prefix or file path prefix)' },
      },
      required: ['sourceId', 'query'],
    },
  },
  {
    name: 'k01_configure_embeddings',
    description: 'Configure the embedding provider for semantic search. Supports Ollama (local) and OpenAI (cloud).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', enum: ['ollama', 'openai'], description: 'Embedding provider' },
        model: { type: 'string', description: 'Model name (e.g. "nomic-embed-text" for Ollama, "text-embedding-3-small" for OpenAI)' },
        apiKey: { type: 'string', description: 'API key (required for OpenAI)' },
        baseUrl: { type: 'string', description: 'Custom base URL (default: auto-detected)' },
      },
      required: ['provider', 'model'],
    },
  },
  {
    name: 'k01_build_embeddings',
    description: 'Build embeddings for a source. Must be called before semantic search works. Requires embedding provider to be configured.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        chunkSize: { type: 'number', description: 'Words per chunk (default: 500)' },
        overlap: { type: 'number', description: 'Overlap words between chunks (default: 50)' },
      },
      required: ['sourceId'],
    },
  },
  // ── Phase 4: Knowledge Graph Tools ──────────────
  {
    name: 'k01_build_graph',
    description: 'Build knowledge graph for a source — extract entities, relationships, and detect communities. Can be re-run to update.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        mode: { type: 'string', enum: ['rule-based', 'llm-enhanced', 'hybrid'], description: 'Extraction mode (default: rule-based)' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'k01_get_entities',
    description: 'Query entities in the knowledge graph with optional filters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Filter by source ID' },
        type: { type: 'string', description: 'Filter by entity type (concept, term, function, class, etc.)' },
        communityId: { type: 'string', description: 'Filter by community ID' },
        name: { type: 'string', description: 'Filter by name (substring match)' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
  {
    name: 'k01_get_relationships',
    description: 'Query relationships in the knowledge graph for an entity or by type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity ID to get relationships for' },
        type: { type: 'string', description: 'Filter by relationship type (calls, imports, references, etc.)' },
        direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], description: 'Direction (default: both)' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
  {
    name: 'k01_get_entity_detail',
    description: 'Get full detail of a specific entity including all relationships, locations, and community membership.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'Entity ID' },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'k01_get_communities',
    description: 'Get thematic/structural communities in the knowledge graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Filter by source ID' },
        level: { type: 'number', description: 'Filter by hierarchy level' },
      },
    },
  },
  {
    name: 'k01_get_community_detail',
    description: 'Get full detail of a community — summary, member entities, internal relationships.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        communityId: { type: 'string', description: 'Community ID' },
      },
      required: ['communityId'],
    },
  },
  {
    name: 'k01_find_path',
    description: 'Find shortest path between two entities through the relationship graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromEntityId: { type: 'string', description: 'Source entity ID' },
        toEntityId: { type: 'string', description: 'Target entity ID' },
        maxDepth: { type: 'number', description: 'Max path depth (default: 5)' },
      },
      required: ['fromEntityId', 'toEntityId'],
    },
  },
  {
    name: 'k01_search_graph',
    description: 'Search the knowledge graph by name, description, or relationship type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        entityTypes: { type: 'array', items: { type: 'string' }, description: 'Filter entity types' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'k01_link_sources',
    description: 'Find and create links between entities across two sources. Detects shared concepts by name similarity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId1: { type: 'string', description: 'First source ID' },
        sourceId2: { type: 'string', description: 'Second source ID' },
      },
      required: ['sourceId1', 'sourceId2'],
    },
  },
  {
    name: 'k01_configure_extraction',
    description: 'Configure the entity extraction mode. Default is rule-based (zero LLM cost).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: ['rule-based', 'llm-enhanced', 'hybrid'], description: 'Extraction mode' },
        provider: { type: 'string', description: 'LLM provider (for llm-enhanced/hybrid)' },
        model: { type: 'string', description: 'LLM model name' },
        apiKey: { type: 'string', description: 'API key' },
      },
      required: ['mode'],
    },
  },
  // ── Phase 5: Recursive Analysis Tools ──────────
  {
    name: 'k01_create_analysis_plan',
    description: 'Generate a recursive analysis plan for a source. Decomposes into leaf tasks (direct reading) and synthesis tasks (combining results). Bottom-up execution.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Document or project ID' },
        maxLeafTokens: { type: 'number', description: 'Max tokens per leaf task (default: 8000)' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'k01_get_analysis_plan',
    description: 'Get the current state of an analysis plan with task tree and progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'k01_get_next_task',
    description: 'Get the next actionable task in the plan. Returns leaf tasks first (bottom-up). Synthesis tasks become available when all children are complete.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'k01_complete_task',
    description: 'Mark a task as complete with analysis result. Automatically saves to persistent store and advances the plan.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        taskId: { type: 'string', description: 'Task ID to complete' },
        analysis: { type: 'string', description: 'The analysis content' },
        confidence: { type: 'number', description: 'Confidence score 0.0-1.0' },
      },
      required: ['planId', 'taskId', 'analysis'],
    },
  },
  {
    name: 'k01_get_summary_tree',
    description: 'Access the hierarchical summary tree. Level 0 = most detailed, higher levels = more abstract.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Source ID' },
        level: { type: 'number', description: 'Specific level to retrieve (omit for full tree)' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'k01_query_at_level',
    description: 'RAPTOR-style retrieval — find relevant summaries at the appropriate level of detail.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Source ID' },
        query: { type: 'string', description: 'Search query' },
        level: { type: 'number', description: 'Abstraction level (omit to search all levels)' },
      },
      required: ['sourceId', 'query'],
    },
  },
  {
    name: 'k01_get_plan_summary',
    description: 'Human-readable progress report — what\'s done, what\'s next, low-confidence flags.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'k01_reanalyse_task',
    description: 'Re-open a completed task for re-analysis. Also re-opens dependent parent synthesis tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        taskId: { type: 'string', description: 'Task ID to re-open' },
        reason: { type: 'string', description: 'Reason for re-analysis' },
      },
      required: ['planId', 'taskId'],
    },
  },
  // ── Phase 6: Synthesis & Export Tools ───────────
  {
    name: 'k01_create_collection',
    description: 'Group multiple sources into a named collection for cross-source analysis.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Collection name' },
        sourceIds: { type: 'array', items: { type: 'string' }, description: 'Source IDs to include' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['name', 'sourceIds'],
    },
  },
  {
    name: 'k01_get_collection',
    description: 'Get overview of a collection including cross-source relationships and shared entities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
      },
      required: ['collectionId'],
    },
  },
  {
    name: 'k01_cross_search',
    description: 'Search across multiple sources simultaneously, ranked by relevance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
        query: { type: 'string', description: 'Search query' },
        entityTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by entity types' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
      required: ['collectionId', 'query'],
    },
  },
  {
    name: 'k01_compare_treatments',
    description: 'Compare how different sources in a collection treat the same concept/entity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
        entityName: { type: 'string', description: 'Entity/concept name to compare' },
      },
      required: ['collectionId', 'entityName'],
    },
  },
  {
    name: 'k01_find_contradictions',
    description: 'Identify conflicting information across sources in a collection.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
      },
      required: ['collectionId'],
    },
  },
  {
    name: 'k01_find_agreements',
    description: 'Identify information corroborated across multiple sources.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
      },
      required: ['collectionId'],
    },
  },
  {
    name: 'k01_generate_synthesis',
    description: 'Generate a comprehensive cross-source synthesis report. The agent uses the returned data to build the report.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
        synthesisType: { type: 'string', enum: ['overview', 'comparison', 'gaps', 'timeline', 'custom'], description: 'Type of synthesis' },
        customPrompt: { type: 'string', description: 'Custom synthesis instructions (for type=custom)' },
      },
      required: ['collectionId', 'synthesisType'],
    },
  },
  {
    name: 'k01_export_report',
    description: 'Export all knowledge about a source as a standalone report.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Source ID' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'Export format' },
        includeAnalyses: { type: 'boolean', description: 'Include analyses (default: true)' },
        includeGraph: { type: 'boolean', description: 'Include knowledge graph (default: true)' },
        includeSummaryTree: { type: 'boolean', description: 'Include summary tree (default: true)' },
      },
      required: ['sourceId', 'format'],
    },
  },
  {
    name: 'k01_export_graph',
    description: 'Export knowledge graph in standard formats (JSON, GraphML for Neo4j/Gephi, CSV for spreadsheets).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string', description: 'Source ID (omit for all sources)' },
        format: { type: 'string', enum: ['json', 'graphml', 'csv'], description: 'Export format' },
      },
      required: ['format'],
    },
  },
  {
    name: 'k01_export_collection_report',
    description: 'Export a comprehensive cross-source synthesis report for a collection.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'Export format' },
      },
      required: ['collectionId', 'format'],
    },
  },
  {
    name: 'k01_get_config',
    description: 'Get current K-01 configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'k01_set_config',
    description: 'Update a configuration value.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Config path (e.g. "parsers.pdf.preferred")' },
        value: { type: 'string', description: 'New value' },
      },
      required: ['path', 'value'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Ingestion ─────────────────────────────────
      case 'k01_ingest_document': {
        const doc = await pipeline.ingestDocument({
          filePath: (args as any).filePath,
          title: (args as any).title,
        });
        return {
          content: [{
            type: 'text',
            text: `Document ingested successfully.\n\nID: ${doc.id}\nTitle: ${doc.title}\nType: ${doc.sourceType}\nLines: ${doc.totalLines}\nWords: ${doc.totalWords}\nSections: ${doc.structure.totalSections}\n\nUse k01_get_structure with id="${doc.id}" to see the document outline.`,
          }],
        };
      }

      case 'k01_ingest_project': {
        const proj = await pipeline.ingestProject({
          rootPath: (args as any).rootPath,
          name: (args as any).name,
          excludePatterns: (args as any).excludePatterns,
        });
        const langSummary = Object.entries(proj.languages)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .map(([lang, count]) => `  ${lang}: ${count} files`)
          .join('\n');
        return {
          content: [{
            type: 'text',
            text: `Project ingested successfully.\n\nID: ${proj.id}\nName: ${proj.name}\nFiles: ${proj.totalFiles}\nLines: ${proj.totalLines}\nSymbols: ${proj.structure.totalSymbols}\nLanguages:\n${langSummary}\n\nUse k01_get_structure with id="${proj.id}" to see the file tree.`,
          }],
        };
      }

      // ── Navigation ────────────────────────────────
      case 'k01_get_structure': {
        const structure = navigator.getStructure(
          (args as any).id,
          (args as any).depth,
        );
        return { content: [{ type: 'text', text: structure }] };
      }

      case 'k01_read_section': {
        const content = navigator.readSection({
          docId: (args as any).docId,
          sectionId: (args as any).sectionId,
          includeChildren: (args as any).includeChildren,
          maxLines: (args as any).maxLines,
        });
        return { content: [{ type: 'text', text: content }] };
      }

      case 'k01_read_range': {
        const content = navigator.readRange({
          id: (args as any).id,
          filePath: (args as any).filePath,
          startLine: (args as any).startLine,
          endLine: (args as any).endLine,
        });
        return { content: [{ type: 'text', text: content }] };
      }

      case 'k01_read_file': {
        const content = navigator.readProjectFile(
          (args as any).projectId,
          (args as any).filePath,
        );
        return { content: [{ type: 'text', text: content }] };
      }

      // ── Search ────────────────────────────────────
      case 'k01_search': {
        const results = searchEngine.search({
          id: (args as any).id,
          query: (args as any).query,
          scope: (args as any).scope,
          scopeId: (args as any).scopeId,
          caseSensitive: (args as any).caseSensitive,
          regex: (args as any).regex,
          contextLines: (args as any).contextLines,
        });

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const formatted = results.map((r, i) => {
          let header = `--- Match ${i + 1} (line ${r.lineNumber})`;
          if (r.sectionId) header += ` [section: ${r.sectionId}]`;
          if (r.filePath) header += ` [file: ${r.filePath}]`;
          header += ' ---';
          return `${header}\n${r.context}`;
        }).join('\n\n');

        return { content: [{ type: 'text', text: `Found ${results.length} results:\n\n${formatted}` }] };
      }

      // ── Management ────────────────────────────────
      case 'k01_list_sources': {
        const docs = docStore.listDocuments();
        const projs = projectStore.listProjects();

        const lines: string[] = [];

        if (docs.length === 0 && projs.length === 0) {
          return { content: [{ type: 'text', text: 'No sources ingested yet. Use k01_ingest_document or k01_ingest_project to get started.' }] };
        }

        if (docs.length > 0) {
          lines.push('## Documents\n');
          for (const docId of docs) {
            try {
              const meta = docStore.loadMeta(docId);
              lines.push(`- **${meta.title}** (${meta.sourceType}) — ${meta.totalLines} lines, ${meta.totalWords} words — ID: \`${docId}\``);
            } catch {
              lines.push(`- ID: \`${docId}\` (metadata unavailable)`);
            }
          }
        }

        if (projs.length > 0) {
          lines.push('\n## Projects\n');
          for (const projId of projs) {
            try {
              const meta = projectStore.loadMeta(projId);
              lines.push(`- **${meta.name}** — ${meta.totalFiles} files, ${meta.totalLines} lines — ID: \`${projId}\``);
            } catch {
              lines.push(`- ID: \`${projId}\` (metadata unavailable)`);
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'k01_get_info': {
        const id = (args as any).id;

        if (docStore.exists(id)) {
          const meta = docStore.loadMeta(id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                type: 'document',
                id: meta.id,
                title: meta.title,
                sourceType: meta.sourceType,
                sourcePath: meta.sourcePath,
                totalLines: meta.totalLines,
                totalWords: meta.totalWords,
                totalSections: meta.structure.totalSections,
                maxDepth: meta.structure.maxDepth,
                outline: meta.structure.outline,
                metadata: meta.metadata,
                createdAt: meta.createdAt,
              }, null, 2),
            }],
          };
        }

        if (projectStore.exists(id)) {
          const meta = projectStore.loadMeta(id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                type: 'project',
                id: meta.id,
                name: meta.name,
                rootPath: meta.rootPath,
                totalFiles: meta.totalFiles,
                totalLines: meta.totalLines,
                totalSymbols: meta.structure.totalSymbols,
                languages: meta.languages,
                createdAt: meta.createdAt,
              }, null, 2),
            }],
          };
        }

        throw new McpError(ErrorCode.InvalidRequest, `Source not found: ${id}. Use k01_list_sources to see available sources.`);
      }

      case 'k01_delete_source': {
        const id = (args as any).id;
        const deletedDoc = docStore.deleteDocument(id);
        const deletedProj = projectStore.deleteProject(id);
        analysisStore.deleteAllForSource(id);
        sessionStore.deleteForSource(id);

        if (deletedDoc || deletedProj) {
          return { content: [{ type: 'text', text: `Source ${id} deleted successfully.` }] };
        }
        throw new McpError(ErrorCode.InvalidRequest, `Source not found: ${id}`);
      }

      // ── Phase 2: Analysis ───────────────────────────
      case 'k01_save_analysis': {
        const entry = analysisStore.save({
          sourceId: (args as any).sourceId,
          scopeId: (args as any).scopeId,
          analysisType: (args as any).analysisType,
          content: (args as any).content,
          tags: (args as any).tags,
          confidence: (args as any).confidence,
        });
        return {
          content: [{
            type: 'text',
            text: `Analysis saved.\n\nID: ${entry.id}\nType: ${entry.analysisType}\nScope: ${entry.scopeId}\nVersion: ${entry.metadata.version}\n\nUse k01_get_analysis to retrieve it.`,
          }],
        };
      }

      case 'k01_get_analysis': {
        const entry = analysisStore.get(
          (args as any).sourceId,
          (args as any).scopeId,
          (args as any).analysisType,
        );
        if (!entry) {
          return { content: [{ type: 'text', text: `No analysis found for scope="${(args as any).scopeId}", type="${(args as any).analysisType}". Use k01_save_analysis to create one.` }] };
        }
        return {
          content: [{
            type: 'text',
            text: `## Analysis: ${entry.analysisType} (${entry.scopeId})\n**Version**: ${entry.metadata.version} | **Updated**: ${entry.updatedAt}${entry.metadata.tags ? ' | **Tags**: ' + entry.metadata.tags.join(', ') : ''}${entry.metadata.confidence !== undefined ? ' | **Confidence**: ' + entry.metadata.confidence : ''}\n\n${entry.content}`,
          }],
        };
      }

      case 'k01_list_analyses': {
        const analyses = analysisStore.list(
          (args as any).sourceId,
          (args as any).scopeId,
          (args as any).analysisType,
        );
        if (analyses.length === 0) {
          return { content: [{ type: 'text', text: 'No analyses found. Use k01_save_analysis to create one.' }] };
        }
        const lines = analyses.map((a) => {
          const tags = a.metadata.tags ? ` [${a.metadata.tags.join(', ')}]` : '';
          const conf = a.metadata.confidence !== undefined ? ` (confidence: ${a.metadata.confidence})` : '';
          return `- **${a.analysisType}** @ ${a.scopeId} — v${a.metadata.version}, updated ${a.updatedAt}${tags}${conf}`;
        });
        return { content: [{ type: 'text', text: `## Analyses (${analyses.length})\n\n${lines.join('\n')}` }] };
      }

      case 'k01_update_analysis': {
        const entry = analysisStore.update({
          sourceId: (args as any).sourceId,
          scopeId: (args as any).scopeId,
          analysisType: (args as any).analysisType,
          content: (args as any).content,
          append: (args as any).append,
        });
        return {
          content: [{
            type: 'text',
            text: `Analysis updated.\n\nType: ${entry.analysisType}\nScope: ${entry.scopeId}\nVersion: ${entry.metadata.version}\nMode: ${(args as any).append ? 'appended' : 'replaced'}`,
          }],
        };
      }

      case 'k01_delete_analysis': {
        const deleted = analysisStore.delete(
          (args as any).sourceId,
          (args as any).scopeId,
          (args as any).analysisType,
        );
        if (deleted) {
          return { content: [{ type: 'text', text: 'Analysis deleted.' }] };
        }
        return { content: [{ type: 'text', text: 'No matching analysis found to delete.' }] };
      }

      // ── Phase 2: Sessions ──────────────────────────
      case 'k01_start_session': {
        const sourceId = (args as any).sourceId;

        // Get total sections for progress tracking
        let totalSections = 0;
        let structureSummary = '';
        if (docStore.exists(sourceId)) {
          const structure = docStore.loadStructure(sourceId);
          totalSections = structure.totalSections;
          structureSummary = `Document with ${totalSections} sections.\n\nOutline:\n${structure.outline}`;
        } else if (projectStore.exists(sourceId)) {
          const meta = projectStore.loadMeta(sourceId);
          totalSections = meta.totalFiles;
          structureSummary = `Project "${meta.name}" with ${meta.totalFiles} files across ${Object.keys(meta.languages).length} languages.`;
        } else {
          throw new McpError(ErrorCode.InvalidRequest, `Source not found: ${sourceId}`);
        }

        const session = sessionStore.startOrResume(sourceId, totalSections, (args as any).notes);

        // Get existing analyses
        const existingAnalyses = analysisStore.list(sourceId);
        const analysisInfo = existingAnalyses.length > 0
          ? `\n\nExisting analyses (${existingAnalyses.length}):\n${existingAnalyses.map(a => `- ${a.analysisType} @ ${a.scopeId}`).join('\n')}`
          : '\n\nNo existing analyses yet.';

        const resumed = session.progress.completedSections.length > 0;
        return {
          content: [{
            type: 'text',
            text: `Session ${resumed ? 'resumed' : 'started'}.\n\nSession ID: ${session.id}\nStatus: ${session.status}\nProgress: ${session.progress.completedSections.length}/${totalSections} sections (${session.progress.percentComplete}%)\n\n${structureSummary}${analysisInfo}`,
          }],
        };
      }

      case 'k01_get_session_progress': {
        const session = sessionStore.getProgress((args as any).sessionId);

        // Get analyses count
        const analyses = analysisStore.list(session.sourceId);

        const remaining = session.progress.totalSections - session.progress.completedSections.length;
        const completedList = session.progress.completedSections.length > 0
          ? `\nCompleted sections:\n${session.progress.completedSections.map(s => `  ✓ ${s}`).join('\n')}`
          : '';

        return {
          content: [{
            type: 'text',
            text: `## Session Progress\n\nSession: ${session.id}\nStatus: ${session.status}\nProgress: ${session.progress.completedSections.length}/${session.progress.totalSections} (${session.progress.percentComplete}%)\nRemaining: ${remaining} sections\nAnalyses saved: ${analyses.length}${completedList}\n\nNotes: ${session.notes || '(none)'}`,
          }],
        };
      }

      case 'k01_update_session': {
        const session = sessionStore.update(
          (args as any).sessionId,
          {
            completedSection: (args as any).completedSection,
            notes: (args as any).notes,
            status: (args as any).status,
          },
        );
        return {
          content: [{
            type: 'text',
            text: `Session updated.\n\nStatus: ${session.status}\nProgress: ${session.progress.completedSections.length}/${session.progress.totalSections} (${session.progress.percentComplete}%)${(args as any).completedSection ? `\nMarked complete: ${(args as any).completedSection}` : ''}`,
          }],
        };
      }

      // ── Phase 2: Comparison ─────────────────────────
      case 'k01_compare_sections': {
        const sourceId = (args as any).sourceId;
        const sectionIds: string[] = (args as any).sectionIds;

        if (!docStore.exists(sourceId)) {
          throw new McpError(ErrorCode.InvalidRequest, `Document not found: ${sourceId}`);
        }

        const parts: string[] = [];
        for (const sectionId of sectionIds) {
          try {
            const content = navigator.readSection({
              docId: sourceId,
              sectionId,
              includeChildren: false,
              maxLines: 200,
            });
            parts.push(`## Section: ${sectionId}\n\n${content}`);
          } catch {
            parts.push(`## Section: ${sectionId}\n\n_Section not found._`);
          }
        }

        const aspectNote = (args as any).aspects
          ? `\n\n**Focus aspects**: ${(args as any).aspects.join(', ')}`
          : '';

        return {
          content: [{
            type: 'text',
            text: `# Section Comparison (${sectionIds.length} sections)${aspectNote}\n\n${parts.join('\n\n---\n\n')}`,
          }],
        };
      }

      case 'k01_get_analysis_summary': {
        const summary = analysisStore.getAnalysisSummary(
          (args as any).sourceId,
          (args as any).analysisTypes,
        );

        if (summary.totalAnalyses === 0) {
          return { content: [{ type: 'text', text: 'No analyses saved for this source yet. Use k01_save_analysis to start.' }] };
        }

        const scopeLines = Object.entries(summary.byScope).map(([scope, info]) => {
          return `- **${scope}**: ${info.types.join(', ')} (last updated: ${info.lastUpdated})`;
        });

        const typeLines = Object.entries(summary.byType).map(([type, count]) => {
          return `- **${type}**: ${count} analyses`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Analysis Summary\n\nTotal analyses: ${summary.totalAnalyses}\n\n### By Scope\n${scopeLines.join('\n')}\n\n### By Type\n${typeLines.join('\n')}`,
          }],
        };
      }

      // ── Phase 3: Code Intelligence ───────────────
      case 'k01_get_symbols': {
        const projectId = (args as any).projectId;
        if (!projectStore.exists(projectId)) {
          throw new McpError(ErrorCode.InvalidRequest, `Project not found: ${projectId}`);
        }
        const meta = projectStore.loadMeta(projectId);
        let symbols = meta.structure.symbols || [];

        // Filters
        const filterPath = (args as any).filePath;
        const filterKind = (args as any).kind;
        const filterName = (args as any).name;

        if (filterPath) {
          symbols = symbols.filter((s) => s.filePath === filterPath || s.filePath.endsWith('/' + filterPath));
        }
        if (filterKind) {
          symbols = symbols.filter((s) => s.kind === filterKind);
        }
        if (filterName) {
          const lower = filterName.toLowerCase();
          symbols = symbols.filter((s) => s.name.toLowerCase().includes(lower));
        }

        const lines = symbols.slice(0, 100).map((s) => {
          const sig = s.signature ? ` — \`${s.signature}\`` : '';
          return `- **${s.kind}** \`${s.name}\` @ ${s.filePath}:${s.startLine}${sig}`;
        });

        const truncated = symbols.length > 100 ? `\n\n_Showing 100 of ${symbols.length} symbols. Use filters to narrow._` : '';
        return {
          content: [{
            type: 'text',
            text: `## Symbols (${symbols.length})${codeExtractor.isTreeSitterAvailable() ? ' [Tree-sitter]' : ' [regex]'}\n\n${lines.join('\n')}${truncated}`,
          }],
        };
      }

      case 'k01_get_call_graph': {
        const projectId = (args as any).projectId;
        const symbolName = (args as any).symbolName;
        const direction = (args as any).direction || 'both';
        const depth = (args as any).depth || 2;

        if (!projectStore.exists(projectId)) {
          throw new McpError(ErrorCode.InvalidRequest, `Project not found: ${projectId}`);
        }

        const meta = projectStore.loadMeta(projectId);
        const allSymbols = (meta.structure.symbols || []) as any[];

        const target = allSymbols.find((s) => s.name === symbolName);
        if (!target) {
          return { content: [{ type: 'text', text: `Symbol "${symbolName}" not found in project. Use k01_get_symbols to list available symbols.` }] };
        }

        const parts: string[] = [`## Call Graph: ${symbolName}\n`];

        if (direction === 'callers' || direction === 'both') {
          const callers = target.calledBy || [];
          parts.push(`### Callers (${callers.length})`);
          if (callers.length > 0) {
            callers.forEach((c: string) => parts.push(`  ← ${c}`));
          } else {
            parts.push('  _(no callers found)_');
          }
        }

        if (direction === 'callees' || direction === 'both') {
          const callees = target.calls || [];
          parts.push(`### Callees (${callees.length})`);
          if (callees.length > 0) {
            callees.forEach((c: string) => parts.push(`  → ${c}`));
          } else {
            parts.push('  _(no callees found)_');
          }
        }

        if (!codeExtractor.isTreeSitterAvailable()) {
          parts.push('\n> _Note: Call graph requires Tree-sitter grammars. Currently using regex fallback which does not extract calls._');
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_get_dependencies': {
        const projectId = (args as any).projectId;
        const filePath = (args as any).filePath;
        const direction = (args as any).direction || 'both';

        if (!projectStore.exists(projectId)) {
          throw new McpError(ErrorCode.InvalidRequest, `Project not found: ${projectId}`);
        }

        const meta = projectStore.loadMeta(projectId);
        const allSymbols = (meta.structure.symbols || []) as any[];

        // Find symbols in this file to get their imports
        const fileSymbols = allSymbols.filter((s) => s.filePath === filePath || s.filePath.endsWith('/' + filePath));
        const imports = new Set<string>();
        for (const s of fileSymbols) {
          for (const imp of (s.imports || [])) {
            imports.add(imp);
          }
        }

        const parts: string[] = [`## Dependencies: ${filePath}\n`];

        if (direction === 'imports' || direction === 'both') {
          parts.push(`### Imports (${imports.size})`);
          if (imports.size > 0) {
            imports.forEach((m) => parts.push(`  → ${m}`));
          } else {
            parts.push('  _(no imports found)_');
          }
        }

        if (direction === 'importedBy' || direction === 'both') {
          // Find other files that import this file
          const importers = new Set<string>();
          for (const s of allSymbols) {
            if (s.filePath !== filePath) {
              for (const imp of (s.imports || [])) {
                if (imp.includes(filePath) || filePath.includes(imp)) {
                  importers.add(s.filePath);
                }
              }
            }
          }
          parts.push(`### Imported By (${importers.size})`);
          if (importers.size > 0) {
            importers.forEach((f) => parts.push(`  ← ${f}`));
          } else {
            parts.push('  _(no importers found)_');
          }
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_get_impact': {
        const projectId = (args as any).projectId;
        const symbolName = (args as any).symbolName;

        if (!projectStore.exists(projectId)) {
          throw new McpError(ErrorCode.InvalidRequest, `Project not found: ${projectId}`);
        }

        const meta = projectStore.loadMeta(projectId);
        const allSymbols = (meta.structure.symbols || []) as any[];

        // Transitive callers — BFS
        const impacted = new Set<string>();
        const impactedFiles = new Set<string>();
        const queue = [symbolName];
        const visited = new Set<string>();

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);

          const sym = allSymbols.find((s) => s.name === current);
          if (sym) {
            impacted.add(`${sym.name} (${sym.kind} @ ${sym.filePath}:${sym.startLine})`);
            impactedFiles.add(sym.filePath);
            for (const caller of (sym.calledBy || [])) {
              if (!visited.has(caller)) queue.push(caller);
            }
          }
        }

        impacted.delete(`${symbolName} (${allSymbols.find((s) => s.name === symbolName)?.kind} @ ${allSymbols.find((s) => s.name === symbolName)?.filePath}:${allSymbols.find((s) => s.name === symbolName)?.startLine})`);

        return {
          content: [{
            type: 'text',
            text: `## Impact Analysis: ${symbolName}\n\n**Impacted symbols**: ${impacted.size}\n**Impacted files**: ${impactedFiles.size}\n\n### Symbols\n${[...impacted].map((s) => `- ${s}`).join('\n') || '_(none)_'}\n\n### Files\n${[...impactedFiles].map((f) => `- ${f}`).join('\n') || '_(none)_'}${!codeExtractor.isTreeSitterAvailable() ? '\n\n> _Note: Impact analysis requires Tree-sitter for call graph extraction._' : ''}`,
          }],
        };
      }

      // ── Phase 3: Parser Status ──────────────────────
      case 'k01_get_parser_status': {
        const pdfStatus = detectPdfParsers(config.parsers.pdf);
        const treeSitterAvailable = codeExtractor.isTreeSitterAvailable();
        const grammars = codeExtractor.getAvailableGrammars();
        const supported = getSupportedLanguages();
        const embeddingStatus = embeddingProvider.isConfigured()
          ? `Configured: ${embeddingProvider.getProviderName()} (${config.embeddings.model})`
          : 'Not configured';

        return {
          content: [{
            type: 'text',
            text: `## Parser Status\n\n### PDF Parsers\n- **MinerU**: ${pdfStatus.mineru ? 'installed' : 'not found'}\n- **Marker**: ${pdfStatus.marker ? 'installed' : 'not found'}\n- **pdf-parse**: ${pdfStatus.pdfParse ? 'installed' : 'not found'}\n- **Active**: ${pdfStatus.active}\n\n### Code Parsing (Tree-sitter)\n- **Status**: ${treeSitterAvailable ? 'active' : 'not available (using regex fallback)'}\n- **Grammars installed**: ${grammars.length > 0 ? grammars.join(', ') : 'none'}\n- **Supported languages**: ${supported.join(', ')}\n- **Grammars directory**: ${codeExtractor.getGrammarsDir() || 'N/A'}\n\n### Embeddings\n- **Status**: ${embeddingStatus}\n\n> To install Tree-sitter grammars, place .wasm files in the grammars directory.`,
          }],
        };
      }

      // ── Phase 3: Semantic Search ────────────────────
      case 'k01_semantic_search': {
        const sourceId = (args as any).sourceId;
        const query = (args as any).query;
        const topK = (args as any).topK || 10;
        const scope = (args as any).scope;

        if (!embeddingProvider.isConfigured()) {
          throw new McpError(ErrorCode.InvalidRequest, 'Embedding provider not configured. Use k01_configure_embeddings first.');
        }

        if (!embeddingStore.hasEmbeddings(sourceId)) {
          throw new McpError(ErrorCode.InvalidRequest, `No embeddings built for source ${sourceId}. Use k01_build_embeddings first.`);
        }

        const queryEmbedding = await embeddingProvider.embedSingle(query);
        const results = embeddingStore.search(sourceId, queryEmbedding, topK, scope);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const lines = results.map((r, i) => {
          const preview = r.chunkText.length > 200 ? r.chunkText.substring(0, 200) + '...' : r.chunkText;
          return `### ${i + 1}. Score: ${r.score.toFixed(4)} — ${r.scopeId}\n\n${preview}`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Semantic Search Results (${results.length})\n\nQuery: "${query}"\n\n${lines.join('\n\n---\n\n')}`,
          }],
        };
      }

      case 'k01_configure_embeddings': {
        const provider = (args as any).provider as 'ollama' | 'openai';
        const model = (args as any).model;
        const apiKey = (args as any).apiKey;
        const baseUrl = (args as any).baseUrl;

        embeddingProvider.configure(provider, model, apiKey, baseUrl);

        return {
          content: [{
            type: 'text',
            text: `Embedding provider configured.\n\nProvider: ${provider}\nModel: ${model}${baseUrl ? '\nBase URL: ' + baseUrl : ''}\n\nUse k01_build_embeddings to build embeddings for a source.`,
          }],
        };
      }

      case 'k01_build_embeddings': {
        const sourceId = (args as any).sourceId;
        const chunkSizeParam = (args as any).chunkSize || 500;
        const overlapParam = (args as any).overlap || 50;

        if (!embeddingProvider.isConfigured()) {
          throw new McpError(ErrorCode.InvalidRequest, 'Embedding provider not configured. Use k01_configure_embeddings first.');
        }

        // Get source content
        let fullText = '';
        let scopePrefix = '';

        if (docStore.exists(sourceId)) {
          const contentPath = docStore.loadMeta(sourceId).contentPath;
          const fs = await import('node:fs');
          fullText = fs.readFileSync(contentPath, 'utf-8');
          scopePrefix = 'doc';
        } else if (projectStore.exists(sourceId)) {
          // For projects, concatenate all file contents
          throw new McpError(ErrorCode.InvalidRequest, 'Embedding entire projects is not yet supported. Ingest as a document first, or use per-file embedding in a future update.');
        } else {
          throw new McpError(ErrorCode.InvalidRequest, `Source not found: ${sourceId}`);
        }

        // Clear old embeddings
        embeddingStore.deleteForSource(sourceId);

        // Chunk and embed
        const chunks = chunkText(fullText, chunkSizeParam, overlapParam);
        let embedded = 0;
        const batchSize = 10;

        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          const texts = batch.map((c) => c.text);
          const embeddings = await embeddingProvider.embed(texts);

          for (let j = 0; j < batch.length; j++) {
            const chunkIndex = i + j;
            embeddingStore.save(
              sourceId,
              `${scopePrefix}-chunk-${chunkIndex}`,
              batch[j].text,
              embeddings[j],
              config.embeddings.model,
            );
            embedded++;
          }
        }

        return {
          content: [{
            type: 'text',
            text: `Embeddings built.\n\nSource: ${sourceId}\nChunks: ${embedded}\nModel: ${config.embeddings.model}\nProvider: ${config.embeddings.provider}\n\nUse k01_semantic_search to search.`,
          }],
        };
      }

      // ── Phase 4: Knowledge Graph ──────────────────
      case 'k01_build_graph': {
        const sourceId = (args as any).sourceId;
        const mode = (args as any).mode || 'rule-based';

        const result = await graphBuilder.buildGraph(sourceId, mode);
        return {
          content: [{
            type: 'text',
            text: `## Knowledge Graph Built\n\nSource: ${sourceId}\nMode: ${mode}\n\n- **Entities extracted**: ${result.entitiesExtracted}\n- **Relationships created**: ${result.relationshipsCreated}\n- **Communities detected**: ${result.communitiesDetected}\n- **Modularity**: ${result.modularity.toFixed(4)}\n\nUse k01_get_entities, k01_get_communities, k01_search_graph to explore.`,
          }],
        };
      }

      case 'k01_get_entities': {
        const entities = graphStore.getEntities({
          sourceId: (args as any).sourceId,
          type: (args as any).type,
          communityId: (args as any).communityId,
          name: (args as any).name,
          limit: (args as any).limit || 50,
        });

        if (entities.length === 0) {
          return { content: [{ type: 'text', text: 'No entities found. Use k01_build_graph first.' }] };
        }

        const lines = entities.map((e) => {
          const desc = e.description ? ` — ${e.description}` : '';
          const comm = e.communityId ? ` [community: ${e.communityId.substring(0, 8)}]` : '';
          return `- **${e.type}** \`${e.name}\`${desc}${comm}`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Entities (${entities.length})\n\n${lines.join('\n')}`,
          }],
        };
      }

      case 'k01_get_relationships': {
        const rels = graphStore.getRelationships({
          entityId: (args as any).entityId,
          type: (args as any).type,
          direction: (args as any).direction,
          limit: (args as any).limit || 50,
        });

        if (rels.length === 0) {
          return { content: [{ type: 'text', text: 'No relationships found.' }] };
        }

        const lines = rels.map((r) => {
          const desc = r.description ? ` — ${r.description}` : '';
          return `- ${r.sourceEntityId.substring(0, 8)} **—${r.type}→** ${r.targetEntityId.substring(0, 8)} (w:${r.weight})${desc}`;
        });

        // Resolve entity names for readability
        const entityNameCache = new Map<string, string>();
        for (const r of rels) {
          for (const eid of [r.sourceEntityId, r.targetEntityId]) {
            if (!entityNameCache.has(eid)) {
              const ent = graphStore.getEntity(eid);
              entityNameCache.set(eid, ent?.name || eid.substring(0, 8));
            }
          }
        }

        const namedLines = rels.map((r) => {
          const src = entityNameCache.get(r.sourceEntityId) || r.sourceEntityId.substring(0, 8);
          const tgt = entityNameCache.get(r.targetEntityId) || r.targetEntityId.substring(0, 8);
          const desc = r.description ? ` — ${r.description}` : '';
          return `- \`${src}\` **—${r.type}→** \`${tgt}\`${desc}`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Relationships (${rels.length})\n\n${namedLines.join('\n')}`,
          }],
        };
      }

      case 'k01_get_entity_detail': {
        const entityId = (args as any).entityId;
        const entity = graphStore.getEntity(entityId);
        if (!entity) {
          throw new McpError(ErrorCode.InvalidRequest, `Entity not found: ${entityId}`);
        }

        const rels = graphStore.getRelationships({ entityId, limit: 100 });
        const community = entity.communityId ? graphStore.getCommunity(entity.communityId) : null;

        const parts: string[] = [
          `## Entity: ${entity.name}`,
          `\n**Type**: ${entity.type}`,
          entity.description ? `**Description**: ${entity.description}` : '',
          `**Source**: ${entity.sourceId}`,
          entity.communityId ? `**Community**: ${community?.title || entity.communityId}` : '',
          `**Created**: ${entity.createdAt}`,
        ];

        if (entity.locations && entity.locations.length > 0) {
          parts.push('\n### Locations');
          for (const loc of entity.locations) {
            parts.push(`- ${loc.scopeId}${loc.startLine !== undefined ? `:${loc.startLine}` : ''}`);
          }
        }

        if (entity.properties) {
          parts.push('\n### Properties');
          parts.push('```json');
          parts.push(JSON.stringify(entity.properties, null, 2));
          parts.push('```');
        }

        if (rels.length > 0) {
          const outgoing = rels.filter((r) => r.sourceEntityId === entityId);
          const incoming = rels.filter((r) => r.targetEntityId === entityId);

          if (outgoing.length > 0) {
            parts.push(`\n### Outgoing (${outgoing.length})`);
            for (const r of outgoing) {
              const target = graphStore.getEntity(r.targetEntityId);
              parts.push(`- **${r.type}** → \`${target?.name || r.targetEntityId.substring(0, 8)}\``);
            }
          }

          if (incoming.length > 0) {
            parts.push(`\n### Incoming (${incoming.length})`);
            for (const r of incoming) {
              const source = graphStore.getEntity(r.sourceEntityId);
              parts.push(`- \`${source?.name || r.sourceEntityId.substring(0, 8)}\` **${r.type}** →`);
            }
          }
        }

        return { content: [{ type: 'text', text: parts.filter(Boolean).join('\n') }] };
      }

      case 'k01_get_communities': {
        const communities = graphStore.getCommunities({
          sourceId: (args as any).sourceId,
          level: (args as any).level,
        });

        if (communities.length === 0) {
          return { content: [{ type: 'text', text: 'No communities found. Use k01_build_graph first.' }] };
        }

        const lines = communities.map((c) => {
          return `### ${c.title || c.id}\n- **Entities**: ${c.entityCount}\n- **Level**: ${c.level}\n- ${c.summary || '_no summary_'}`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Communities (${communities.length})\n\n${lines.join('\n\n')}`,
          }],
        };
      }

      case 'k01_get_community_detail': {
        const communityId = (args as any).communityId;
        const community = graphStore.getCommunity(communityId);
        if (!community) {
          throw new McpError(ErrorCode.InvalidRequest, `Community not found: ${communityId}`);
        }

        const members = graphStore.getEntities({ communityId, limit: 200 });
        const memberIds = new Set(members.map((m) => m.id));

        // Get internal relationships
        const internalRels: string[] = [];
        for (const member of members) {
          const rels = graphStore.getRelationships({ entityId: member.id, direction: 'outgoing', limit: 50 });
          for (const r of rels) {
            if (memberIds.has(r.targetEntityId)) {
              const target = members.find((m) => m.id === r.targetEntityId);
              internalRels.push(`- \`${member.name}\` **${r.type}** → \`${target?.name || '?'}\``);
            }
          }
        }

        const memberLines = members.map((m) => `- **${m.type}** \`${m.name}\``);

        return {
          content: [{
            type: 'text',
            text: `## Community: ${community.title || community.id}\n\n${community.summary || ''}\n\n**Entities**: ${community.entityCount} | **Level**: ${community.level}\n\n### Members (${members.length})\n${memberLines.join('\n')}\n\n### Internal Relationships (${internalRels.length})\n${internalRels.join('\n') || '_(none)_'}`,
          }],
        };
      }

      case 'k01_find_path': {
        const fromId = (args as any).fromEntityId;
        const toId = (args as any).toEntityId;
        const maxDepth = (args as any).maxDepth || 5;

        const fromEntity = graphStore.getEntity(fromId);
        const toEntity = graphStore.getEntity(toId);
        if (!fromEntity) throw new McpError(ErrorCode.InvalidRequest, `Entity not found: ${fromId}`);
        if (!toEntity) throw new McpError(ErrorCode.InvalidRequest, `Entity not found: ${toId}`);

        const pathResult = graphStore.findPath(fromId, toId, maxDepth);
        if (!pathResult) {
          return { content: [{ type: 'text', text: `No path found between "${fromEntity.name}" and "${toEntity.name}" within depth ${maxDepth}.` }] };
        }

        const pathNames = pathResult.path.map((eid) => {
          const e = graphStore.getEntity(eid);
          return e?.name || eid.substring(0, 8);
        });

        const relLabels = pathResult.relationships.map((r) => r.type);
        const pathStr = pathNames.reduce((acc, name, i) => {
          if (i === 0) return `\`${name}\``;
          return `${acc} —**${relLabels[i - 1]}**→ \`${name}\``;
        }, '');

        return {
          content: [{
            type: 'text',
            text: `## Path Found (${pathResult.path.length} nodes)\n\n${pathStr}`,
          }],
        };
      }

      case 'k01_search_graph': {
        const query = (args as any).query;
        const entityTypes = (args as any).entityTypes;
        const limit = (args as any).limit || 20;

        const entities = graphStore.searchEntities(query, { entityTypes, limit });

        if (entities.length === 0) {
          return { content: [{ type: 'text', text: `No entities found matching "${query}".` }] };
        }

        const lines = entities.map((e) => {
          const desc = e.description ? ` — ${e.description}` : '';
          return `- **${e.type}** \`${e.name}\`${desc} (source: ${e.sourceId.substring(0, 8)})`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Graph Search: "${query}" (${entities.length} results)\n\n${lines.join('\n')}`,
          }],
        };
      }

      case 'k01_link_sources': {
        const sourceId1 = (args as any).sourceId1;
        const sourceId2 = (args as any).sourceId2;

        const links = crossSourceLinker.linkSources(sourceId1, sourceId2);

        if (links.length === 0) {
          return { content: [{ type: 'text', text: `No shared entities found between sources.` }] };
        }

        const lines = links.map((l) => {
          const e1 = graphStore.getEntity(l.entityId1);
          const e2 = graphStore.getEntity(l.entityId2);
          return `- \`${e1?.name || '?'}\` **${l.linkType}** \`${e2?.name || '?'}\` (confidence: ${l.confidence.toFixed(2)}) — ${l.evidence}`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Cross-Source Links (${links.length})\n\n${lines.join('\n')}`,
          }],
        };
      }

      case 'k01_configure_extraction': {
        const mode = (args as any).mode;
        // Store config — for now just acknowledge
        return {
          content: [{
            type: 'text',
            text: `Extraction mode set to: ${mode}\n\n${mode === 'rule-based' ? 'Zero LLM cost. Entities extracted via regex patterns and code structure.' : 'LLM-enhanced extraction requires configuring an LLM provider separately.'}`,
          }],
        };
      }

      // ── Phase 5: Recursive Analysis ─────────────────
      case 'k01_create_analysis_plan': {
        const sourceId = (args as any).sourceId;
        const maxLeafTokens = (args as any).maxLeafTokens || 8000;

        // Must be a document with structure
        if (!docStore.exists(sourceId)) {
          throw new McpError(ErrorCode.InvalidRequest, `Document not found: ${sourceId}. Recursive analysis currently supports documents.`);
        }

        const structure = docStore.loadStructure(sourceId);
        const plan = buildAnalysisPlan(sourceId, structure, maxLeafTokens);
        taskManager.savePlan(plan);

        // Format task tree outline
        const outline = formatTaskTree(plan.tree, 0);

        return {
          content: [{
            type: 'text',
            text: `## Recursive Analysis Plan Created\n\n**Plan ID**: \`${plan.id}\`\n**Source**: ${sourceId}\n**Total tasks**: ${plan.totalTasks}\n\n### Task Tree\n${outline}\n\nUse \`k01_get_next_task\` to start executing.`,
          }],
        };
      }

      case 'k01_get_analysis_plan': {
        const planId = (args as any).planId;
        const plan = taskManager.getPlan(planId);
        if (!plan) throw new McpError(ErrorCode.InvalidRequest, `Plan not found: ${planId}`);

        const outline = formatTaskTree(plan.tree, 0);
        return {
          content: [{
            type: 'text',
            text: `## Analysis Plan: ${plan.id.substring(0, 8)}\n\n**Source**: ${plan.sourceId}\n**Status**: ${plan.status}\n**Progress**: ${plan.completedTasks}/${plan.totalTasks}\n\n### Task Tree\n${outline}`,
          }],
        };
      }

      case 'k01_get_next_task': {
        const planId = (args as any).planId;
        const plan = taskManager.getPlan(planId);
        if (!plan) throw new McpError(ErrorCode.InvalidRequest, `Plan not found: ${planId}`);

        const task = taskManager.getNextTask(plan);
        if (!task) {
          return { content: [{ type: 'text', text: plan.status === 'complete' ? 'Plan is complete! Use k01_get_summary_tree to view results.' : 'No tasks available.' }] };
        }

        const taskContent = taskManager.getTaskContent(plan, task);

        const parts = [
          `## Next Task`,
          `\n**Task ID**: \`${task.id}\``,
          `**Type**: ${task.type}`,
          `**Scope**: ${task.scopeDescription}`,
          `**Words**: ~${task.wordCount} (~${task.estimatedTokens} tokens)`,
        ];

        if (taskContent.type === 'leaf_content') {
          parts.push(`\n### Instructions`);
          parts.push(taskContent.content || '');
          parts.push(`\nAnalyse this section thoroughly, then call:\n\`k01_complete_task(planId="${planId}", taskId="${task.id}", analysis=<your analysis>, confidence=<0.0-1.0>)\``);
        } else {
          parts.push(`\n### Child Analyses to Synthesise (${taskContent.childAnalyses?.length || 0})`);
          for (const ca of (taskContent.childAnalyses || [])) {
            const confStr = ca.confidence !== undefined ? ` (confidence: ${ca.confidence.toFixed(2)})` : '';
            parts.push(`\n#### ${ca.taskDescription}${confStr}\n${ca.analysis}`);
          }
          parts.push(`\nSynthesise these analyses, then call:\n\`k01_complete_task(planId="${planId}", taskId="${task.id}", analysis=<your synthesis>, confidence=<0.0-1.0>)\``);
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_complete_task': {
        const planId = (args as any).planId;
        const taskId = (args as any).taskId;
        const analysis = (args as any).analysis;
        const confidence = (args as any).confidence;

        const plan = taskManager.getPlan(planId);
        if (!plan) throw new McpError(ErrorCode.InvalidRequest, `Plan not found: ${planId}`);

        const result = taskManager.completeTask(plan, taskId, analysis, confidence);

        // Save to summary tree
        const completedTask = findTaskInTree(result.plan.tree, taskId);
        if (completedTask) {
          const childIds = completedTask.children
            .filter((c: AnalysisTaskNode) => c.analysisId)
            .map((c: AnalysisTaskNode) => c.analysisId!);

          summaryTree.saveSummaryNode(
            result.plan.sourceId,
            completedTask.scopeId,
            completedTask.depth,
            completedTask.scopeDescription,
            analysis,
            childIds,
            undefined,
            confidence,
            completedTask.wordCount,
          );
        }

        const progress = `${result.plan.completedTasks}/${result.plan.totalTasks}`;
        const parts = [
          `## Task Completed`,
          `\n**Progress**: ${progress} (${((result.plan.completedTasks / result.plan.totalTasks) * 100).toFixed(0)}%)`,
        ];

        if (confidence !== undefined && confidence < 0.5) {
          parts.push(`\n**Warning**: Low confidence (${confidence}). Consider re-analysing later with \`k01_reanalyse_task\`.`);
        }

        if (result.nextTask) {
          parts.push(`\n**Next task**: ${result.nextTask.type} — ${result.nextTask.scopeDescription}`);
          parts.push(`Use \`k01_get_next_task(planId="${planId}")\` for full details.`);
        } else if (result.plan.status === 'complete') {
          parts.push(`\n**Plan complete!** Use \`k01_get_summary_tree(sourceId="${result.plan.sourceId}")\` to view the hierarchical summary.`);
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_get_summary_tree': {
        const sourceId = (args as any).sourceId;
        const level = (args as any).level;

        if (level !== undefined) {
          const nodes = summaryTree.getNodesAtLevel(sourceId, level);
          if (nodes.length === 0) {
            return { content: [{ type: 'text', text: `No summary nodes at level ${level}. Complete analysis tasks first.` }] };
          }
          const lines = nodes.map((n) => {
            const conf = n.confidence !== undefined ? ` (confidence: ${n.confidence.toFixed(2)})` : '';
            return `### ${n.title}${conf}\n${n.summary}\n_Compression: ${n.compressionRatio.toFixed(1)}x (${n.wordCount} → ${n.summaryWordCount} words)_`;
          });
          return { content: [{ type: 'text', text: `## Summary Tree — Level ${level} (${nodes.length} nodes)\n\n${lines.join('\n\n')}` }] };
        }

        const tree = summaryTree.getSummaryTree(sourceId);
        if (tree.totalLevels === 0) {
          return { content: [{ type: 'text', text: 'No summary tree built yet. Complete recursive analysis tasks first.' }] };
        }

        const parts = [`## Hierarchical Summary Tree\n\n**Source**: ${sourceId}\n**Levels**: ${tree.totalLevels}`];
        for (const lvl of tree.levels) {
          parts.push(`\n### Level ${lvl.level} (${lvl.nodes.length} nodes)`);
          for (const n of lvl.nodes) {
            parts.push(`- **${n.title}** — ${n.summary.substring(0, 150)}${n.summary.length > 150 ? '...' : ''}`);
          }
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_query_at_level': {
        const sourceId = (args as any).sourceId;
        const query = (args as any).query;
        const level = (args as any).level;

        const results = summaryTree.queryAtLevel(sourceId, query, level);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No summaries matching "${query}" found.` }] };
        }

        const lines = results.map((n) => {
          return `### [L${(n as any).level ?? n.compressionRatio > 1 ? '?' : '0'}] ${n.title}\n${n.summary}\n_Confidence: ${n.confidence.toFixed(2)}_`;
        });

        return { content: [{ type: 'text', text: `## Query: "${query}" (${results.length} results)\n\n${lines.join('\n\n')}` }] };
      }

      case 'k01_get_plan_summary': {
        const planId = (args as any).planId;
        const plan = taskManager.getPlan(planId);
        if (!plan) throw new McpError(ErrorCode.InvalidRequest, `Plan not found: ${planId}`);

        return { content: [{ type: 'text', text: taskManager.getPlanSummary(plan) }] };
      }

      case 'k01_reanalyse_task': {
        const planId = (args as any).planId;
        const taskId = (args as any).taskId;
        const reason = (args as any).reason;

        const plan = taskManager.getPlan(planId);
        if (!plan) throw new McpError(ErrorCode.InvalidRequest, `Plan not found: ${planId}`);

        const updated = taskManager.reanalyseTask(plan, taskId, reason);

        return {
          content: [{
            type: 'text',
            text: `## Task Re-opened\n\n**Task**: ${taskId}\n${reason ? `**Reason**: ${reason}\n` : ''}**Progress**: ${updated.completedTasks}/${updated.totalTasks}\n\nUse \`k01_get_next_task\` to get the re-opened task.`,
          }],
        };
      }

      // ── Phase 6: Synthesis & Export ────────────────
      case 'k01_create_collection': {
        const colName = (args as any).name;
        const sourceIds = (args as any).sourceIds as string[];
        const desc = (args as any).description;

        const col = collectionStore.create(colName, sourceIds, desc);
        return {
          content: [{
            type: 'text',
            text: `## Collection Created\n\n**ID**: \`${col.id}\`\n**Name**: ${col.name}\n**Sources**: ${col.sourceIds.length}\n\nUse \`k01_cross_search\`, \`k01_compare_treatments\`, \`k01_find_contradictions\` to analyse across sources.`,
          }],
        };
      }

      case 'k01_get_collection': {
        const colId = (args as any).collectionId;
        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        // Get entity counts per source
        const sourceSummaries = col.sourceIds.map((sid) => {
          const entityCount = graphStore.countEntities(sid);
          const isDoc = docStore.exists(sid);
          const label = isDoc ? docStore.loadMeta(sid).title : (projectStore.exists(sid) ? projectStore.loadMeta(sid).name : sid);
          return `- **${label}** (\`${sid.substring(0, 8)}\`): ${entityCount} entities`;
        });

        return {
          content: [{
            type: 'text',
            text: `## Collection: ${col.name}\n\n${col.description || ''}\n\n### Sources (${col.sourceIds.length})\n${sourceSummaries.join('\n')}`,
          }],
        };
      }

      case 'k01_cross_search': {
        const colId = (args as any).collectionId;
        const query = (args as any).query;
        const entityTypes = (args as any).entityTypes;
        const limit = (args as any).limit || 50;

        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        const results = crossSearch.search(col.sourceIds, query, entityTypes, limit);

        const lines = results.map((r) => `- **${r.name}** [${r.type}] (source: \`${r.sourceId.substring(0, 8)}\`, relevance: ${r.relevance.toFixed(2)})${r.description ? '\n  ' + r.description.substring(0, 120) : ''}`);

        return {
          content: [{
            type: 'text',
            text: `## Cross-Search: "${query}" (${results.length} results)\n\n${lines.join('\n')}`,
          }],
        };
      }

      case 'k01_compare_treatments': {
        const colId = (args as any).collectionId;
        const entityName = (args as any).entityName;

        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        const comparison = crossSearch.compareTreatments(col.sourceIds, entityName);

        if (comparison.treatments.length === 0) {
          return { content: [{ type: 'text', text: `Entity "${entityName}" not found in any source.` }] };
        }

        const parts = [`## Treatment Comparison: "${entityName}"\n`];
        for (const t of comparison.treatments) {
          parts.push(`### Source: \`${t.sourceId.substring(0, 8)}\``);
          parts.push(t.description || '_No description_');
          if (t.relationships.length > 0) {
            parts.push(`\n**Relationships**:`);
            for (const r of t.relationships.slice(0, 10)) {
              parts.push(`- ${r.type} → ${r.targetName}${r.description ? ': ' + r.description : ''}`);
            }
          }
          parts.push('');
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_find_contradictions': {
        const colId = (args as any).collectionId;
        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        const conflicts = crossSearch.findContradictions(col.sourceIds);

        if (conflicts.length === 0) {
          return { content: [{ type: 'text', text: 'No contradictions detected. Sources appear consistent.' }] };
        }

        const lines = conflicts.map((c) =>
          `### ${c.entityA}\n- **Source A** (\`${c.sourceA.substring(0, 8)}\`): ${c.descriptionA.substring(0, 200)}\n- **Source B** (\`${c.sourceB.substring(0, 8)}\`): ${c.descriptionB.substring(0, 200)}\n- _${c.reason}_`
        );

        return { content: [{ type: 'text', text: `## Potential Contradictions (${conflicts.length})\n\n${lines.join('\n\n')}` }] };
      }

      case 'k01_find_agreements': {
        const colId = (args as any).collectionId;
        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        const agreements = crossSearch.findAgreements(col.sourceIds);

        if (agreements.length === 0) {
          return { content: [{ type: 'text', text: 'No shared concepts found across sources. Try building graphs first.' }] };
        }

        const lines = agreements.slice(0, 30).map((a) =>
          `- **${a.concept}** — shared by ${a.sources.length} sources\n  ${a.descriptions.map((d) => `[${d.sourceId.substring(0, 8)}]: ${d.description.substring(0, 100)}`).join('\n  ')}`
        );

        return { content: [{ type: 'text', text: `## Shared Concepts (${agreements.length})\n\n${lines.join('\n\n')}` }] };
      }

      case 'k01_generate_synthesis': {
        const colId = (args as any).collectionId;
        const synthesisType = (args as any).synthesisType;
        const customPrompt = (args as any).customPrompt;

        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        // Gather cross-source data
        const agreements = crossSearch.findAgreements(col.sourceIds);
        const contradictions = crossSearch.findContradictions(col.sourceIds);

        const sourceSummaries: string[] = [];
        for (const sid of col.sourceIds) {
          const label = docStore.exists(sid) ? docStore.loadMeta(sid).title : (projectStore.exists(sid) ? projectStore.loadMeta(sid).name : sid);
          const entityCount = graphStore.countEntities(sid);
          sourceSummaries.push(`- **${label}**: ${entityCount} entities`);
        }

        const parts = [`## Synthesis Report: ${col.name}\n**Type**: ${synthesisType}\n`];
        parts.push(`### Sources\n${sourceSummaries.join('\n')}\n`);

        if (synthesisType === 'overview' || synthesisType === 'custom') {
          parts.push(`### Shared Concepts (${agreements.length})`);
          for (const a of agreements.slice(0, 15)) {
            parts.push(`- **${a.concept}**: ${a.sources.length} sources`);
          }
          parts.push(`\n### Contradictions (${contradictions.length})`);
          for (const c of contradictions.slice(0, 10)) {
            parts.push(`- **${c.entityA}**: diverges between \`${c.sourceA.substring(0, 8)}\` and \`${c.sourceB.substring(0, 8)}\``);
          }
        }

        if (synthesisType === 'comparison') {
          parts.push(`### Side-by-Side\nUse \`k01_compare_treatments\` for specific entities. Key shared concepts:`);
          for (const a of agreements.slice(0, 20)) {
            parts.push(`- ${a.concept}`);
          }
        }

        if (synthesisType === 'gaps') {
          parts.push(`### Coverage Gaps`);
          // Find entities unique to each source
          for (const sid of col.sourceIds) {
            const entities = graphStore.getEntities({ sourceId: sid, limit: 100 });
            const unique = entities.filter((e) => {
              const others = col.sourceIds.filter((s) => s !== sid);
              return !others.some((os) => {
                const osEnts = graphStore.searchEntities(e.name, { sourceId: os });
                return osEnts.length > 0;
              });
            });
            const label = docStore.exists(sid) ? docStore.loadMeta(sid).title : sid;
            parts.push(`\n**Unique to ${label}** (${unique.length}): ${unique.slice(0, 10).map((e) => e.name).join(', ')}`);
          }
        }

        if (customPrompt) {
          parts.push(`\n### Custom Focus\n_${customPrompt}_\n\nUse the data above and cross-search tools to address this focus.`);
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'k01_export_report': {
        const sourceId = (args as any).sourceId;
        const format = (args as any).format;

        let filePath: string;
        if (format === 'markdown') {
          filePath = reportExporter.exportMarkdown(sourceId, {
            includeAnalyses: (args as any).includeAnalyses,
            includeGraph: (args as any).includeGraph,
            includeSummaryTree: (args as any).includeSummaryTree,
          });
        } else {
          filePath = reportExporter.exportJson(sourceId);
        }

        return { content: [{ type: 'text', text: `## Report Exported\n\n**Format**: ${format}\n**File**: \`${filePath}\`` }] };
      }

      case 'k01_export_graph': {
        const sourceId = (args as any).sourceId;
        const format = (args as any).format;

        const filePath = reportExporter.exportGraph(sourceId, format);
        return { content: [{ type: 'text', text: `## Graph Exported\n\n**Format**: ${format}\n**File**: \`${filePath}\`` }] };
      }

      case 'k01_export_collection_report': {
        const colId = (args as any).collectionId;
        const format = (args as any).format;

        const col = collectionStore.get(colId);
        if (!col) throw new McpError(ErrorCode.InvalidRequest, `Collection not found: ${colId}`);

        // Export each source then combine
        const parts = [`# Cross-Source Report: ${col.name}\n\n_Exported: ${new Date().toISOString()}_\n`];
        for (const sid of col.sourceIds) {
          if (format === 'markdown') {
            const isDoc = docStore.exists(sid);
            const label = isDoc ? docStore.loadMeta(sid).title : (projectStore.exists(sid) ? projectStore.loadMeta(sid).name : sid);
            parts.push(`---\n## Source: ${label}\n`);
            const entities = graphStore.getEntities({ sourceId: sid, limit: 50 });
            parts.push(`**Entities**: ${entities.map((e) => e.name).slice(0, 20).join(', ')}\n`);
          }
        }

        // Add cross-source analysis
        const agreements = crossSearch.findAgreements(col.sourceIds);
        const contradictions = crossSearch.findContradictions(col.sourceIds);
        parts.push(`---\n## Cross-Source Analysis\n`);
        parts.push(`### Shared Concepts: ${agreements.length}`);
        parts.push(`### Contradictions: ${contradictions.length}\n`);

        const fsModule = await import('fs');
        const pathModule = await import('path');
        const exportDir = pathModule.join(config.baseDir, 'exports');
        fsModule.mkdirSync(exportDir, { recursive: true });
        const filename = `${col.name.replace(/[^a-zA-Z0-9]/g, '_')}_collection.${format === 'json' ? 'json' : 'md'}`;
        const filePath = pathModule.join(exportDir, filename);

        if (format === 'json') {
          fsModule.writeFileSync(filePath, JSON.stringify({ collection: col, agreements, contradictions }, null, 2), 'utf-8');
        } else {
          fsModule.writeFileSync(filePath, parts.join('\n'), 'utf-8');
        }

        return { content: [{ type: 'text', text: `## Collection Report Exported\n\n**File**: \`${filePath}\`` }] };
      }

      case 'k01_get_config': {
        return {
          content: [{
            type: 'text',
            text: `## K-01 Configuration\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``,
          }],
        };
      }

      case 'k01_set_config': {
        const cfgPath = (args as any).path;
        const cfgValue = (args as any).value;

        // For now, acknowledge the config change — full runtime config updates require config file rewrite
        return {
          content: [{
            type: 'text',
            text: `Configuration noted: \`${cfgPath}\` = \`${cfgValue}\`\n\n_Note: Runtime config changes are session-scoped. For persistent changes, edit the K-01 config file._`,
          }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Error in ${name}: ${msg}`);
  }
});

// ─── Prompts ─────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: 'k01_analyse_document',
    description: 'Systematic deep analysis of an ingested document — reads every section, extracts key themes, and builds comprehensive understanding.',
    arguments: [
      { name: 'docId', description: 'Document ID to analyse', required: true },
    ],
  },
  {
    name: 'k01_explore_codebase',
    description: 'Systematic exploration of an ingested codebase — maps architecture, identifies core modules, and builds structural understanding.',
    arguments: [
      { name: 'projectId', description: 'Project ID to explore', required: true },
    ],
  },
  // ── Phase 2 Prompts ───────────────────────────────
  {
    name: 'k01_deep_analysis',
    description: 'Systematic deep document analysis with persistent progress tracking — survey, section-by-section analysis with saving, and synthesis.',
    arguments: [
      { name: 'sourceId', description: 'Document ID to analyse', required: true },
    ],
  },
  {
    name: 'k01_critical_review',
    description: 'Critical review of a document — evaluates evidence strength, logical consistency, missing perspectives, and potential biases.',
    arguments: [
      { name: 'sourceId', description: 'Document ID to review', required: true },
    ],
  },
  {
    name: 'k01_codebase_audit',
    description: 'Systematic codebase audit — maps architecture, evaluates code quality per module, and produces recommendations.',
    arguments: [
      { name: 'projectId', description: 'Project ID to audit', required: true },
    ],
  },
  // ── Phase 4: Knowledge Graph Prompts ────────────
  {
    name: 'k01_knowledge_mapping',
    description: 'Build a comprehensive knowledge map of a source — extract entities, explore communities, find connections, and synthesise findings.',
    arguments: [
      { name: 'sourceId', description: 'Document or project ID to map', required: true },
    ],
  },
  {
    name: 'k01_cross_source_synthesis',
    description: 'Synthesise knowledge across multiple sources — find shared entities, compare treatments, identify contradictions and agreements.',
    arguments: [
      { name: 'sourceId1', description: 'First source ID', required: true },
      { name: 'sourceId2', description: 'Second source ID', required: true },
    ],
  },
  // ── Phase 5: Recursive Analysis Prompts ─────────
  {
    name: 'k01_recursive_deep_analysis',
    description: 'Full recursive analysis of a large document — decompose, analyse leaves bottom-up, synthesise, build hierarchical summary tree.',
    arguments: [
      { name: 'sourceId', description: 'Document ID to analyse recursively', required: true },
    ],
  },
  {
    name: 'k01_targeted_deep_dive',
    description: 'Targeted deep dive — use hierarchical summaries to zoom into specific areas at different levels of detail.',
    arguments: [
      { name: 'sourceId', description: 'Source ID', required: true },
      { name: 'focusArea', description: 'Topic or area to investigate', required: true },
    ],
  },
  // ── Phase 6: Final Prompts ──────────────────────
  {
    name: 'k01_full_book_analysis',
    description: 'The definitive prompt for comprehensive analysis of an entire book — ingest, survey, recursive analysis, knowledge graph, synthesis, export.',
    arguments: [
      { name: 'filePath', description: 'Path to the book file', required: true },
    ],
  },
  {
    name: 'k01_multi_paper_synthesis',
    description: 'Synthesise knowledge across multiple research papers — ingest, build graphs, create collection, compare, find contradictions, generate synthesis.',
    arguments: [
      { name: 'filePaths', description: 'Comma-separated paths to paper files', required: true },
    ],
  },
  {
    name: 'k01_codebase_deep_understanding',
    description: 'Build comprehensive understanding of a large codebase — ingest, map structure, extract entities, analyse modules, export.',
    arguments: [
      { name: 'projectPath', description: 'Path to the project root', required: true },
    ],
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'k01_analyse_document': {
      const docId = args?.docId || '{DOC_ID}';
      return {
        description: 'Systematic document analysis using K-01 navigation tools',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are performing a systematic, complete analysis of a document using K-01 tools. Your goal is to read EVERY section and build comprehensive understanding.

STEP 1 — SURVEY:
Call k01_get_structure with id="${docId}" to see the full document outline.
Call k01_get_info with id="${docId}" for document statistics.

STEP 2 — SYSTEMATIC READING:
For each major section in the structure:
1. Call k01_read_section with docId="${docId}" and the section's ID
2. Identify: key arguments, evidence, themes, important details, questions
3. Note cross-references to other sections

STEP 3 — TARGETED SEARCH:
Use k01_search to find specific terms, concepts, or patterns across the document.

STEP 4 — SYNTHESIS:
After reading all sections:
1. Identify cross-cutting themes and patterns
2. Note contradictions or tensions
3. Summarise the document's core contribution
4. Produce a comprehensive analysis report

Begin by calling k01_get_structure with id="${docId}".`,
            },
          },
        ],
      };
    }

    case 'k01_explore_codebase': {
      const projectId = args?.projectId || '{PROJECT_ID}';
      return {
        description: 'Systematic codebase exploration using K-01 navigation tools',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are performing a systematic exploration of a codebase using K-01 tools. Your goal is to build complete architectural understanding.

STEP 1 — OVERVIEW:
Call k01_get_structure with id="${projectId}" to see the project layout (file tree and symbols).
Call k01_get_info with id="${projectId}" for project statistics.

STEP 2 — IDENTIFY ARCHITECTURE:
1. Look at the top-level directory structure to identify modules
2. Find entry points (main files, index files, server files)
3. Read key configuration files (package.json, tsconfig, etc.)

STEP 3 — MODULE DEEP DIVE:
For each major module/directory:
1. Call k01_read_file to read the main files
2. Note exported functions, classes, and interfaces
3. Identify dependencies and data flow patterns

STEP 4 — CROSS-CUTTING CONCERNS:
Use k01_search to trace:
1. How modules communicate
2. Shared types and interfaces
3. Error handling patterns
4. Configuration usage

STEP 5 — SYNTHESIS:
Produce an architectural summary covering:
1. Module responsibilities and boundaries
2. Data flow and dependencies
3. Key design patterns used
4. Potential improvements or risks

Begin by calling k01_get_structure with id="${projectId}".`,
            },
          },
        ],
      };
    }

    case 'k01_deep_analysis': {
      const sourceId = args?.sourceId || '{SOURCE_ID}';
      return {
        description: 'Deep document analysis with persistent progress tracking',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are performing a deep analysis of a document using K-01 with persistent progress tracking.

PHASE 1 — Survey:
1. Call k01_start_session with sourceId="${sourceId}" to begin/resume
2. Call k01_get_structure with id="${sourceId}" to see the full outline
3. Save a document-level overview: k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="overview", content=<your overview>)

PHASE 2 — Section-by-section:
For each major section in the outline:
1. k01_read_section to read content
2. Analyse: identify key arguments, evidence, themes, questions
3. k01_save_analysis for the section (analysisType="summary")
4. k01_update_session to mark the section complete

PHASE 3 — Synthesis:
1. k01_get_analysis_summary with sourceId="${sourceId}" to review all section analyses
2. Identify cross-cutting themes, contradictions, patterns
3. k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="synthesis", content=<your synthesis>)
4. k01_update_session(status="complete")

Begin by calling k01_start_session with sourceId="${sourceId}".`,
            },
          },
        ],
      };
    }

    case 'k01_critical_review': {
      const sourceId = args?.sourceId || '{SOURCE_ID}';
      return {
        description: 'Critical document review with persistent analysis',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Perform a critical review of the document using K-01 tools. Save all findings persistently.

1. Call k01_start_session with sourceId="${sourceId}"
2. Call k01_get_structure with id="${sourceId}" to see the outline

For each major section:
1. Read the section with k01_read_section
2. Save a 'critique' analysis (k01_save_analysis) noting:
   - Strength of evidence
   - Logical consistency
   - Missing perspectives
   - Potential biases
3. Mark the section complete with k01_update_session

After all sections:
1. Save a document-level 'critique' synthesising all section critiques:
   k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="critique", content=<synthesis>)
2. Save a 'recommendations' analysis with actionable improvements:
   k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="recommendations", content=<recommendations>)
3. Mark session complete: k01_update_session(status="complete")

Begin by calling k01_start_session with sourceId="${sourceId}".`,
            },
          },
        ],
      };
    }

    case 'k01_codebase_audit': {
      const projectId = args?.projectId || '{PROJECT_ID}';
      return {
        description: 'Systematic codebase audit with persistent analysis',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Perform a systematic codebase audit using K-01 tools. Save all findings persistently.

1. Call k01_start_session with sourceId="${projectId}"
2. Call k01_get_structure with id="${projectId}" to map the architecture

For each major module/directory:
1. Read key files with k01_read_file
2. Save 'architecture' analysis: responsibilities, patterns used
   k01_save_analysis(sourceId="${projectId}", scopeId=<module_path>, analysisType="architecture", content=...)
3. Save 'quality' analysis: code quality observations
   k01_save_analysis(sourceId="${projectId}", scopeId=<module_path>, analysisType="quality", content=...)
4. Mark complete: k01_update_session(completedSection=<module_path>)

After all modules:
1. Save project-level architecture:
   k01_save_analysis(sourceId="${projectId}", scopeId="full", analysisType="architecture", content=<how modules connect>)
2. Save project-level recommendations:
   k01_save_analysis(sourceId="${projectId}", scopeId="full", analysisType="recommendations", content=<improvements, risks>)
3. k01_update_session(status="complete")

Begin by calling k01_start_session with sourceId="${projectId}".`,
            },
          },
        ],
      };
    }

    // ── Phase 4: Knowledge Graph Prompts ────────────
    case 'k01_knowledge_mapping': {
      const sourceId = (args as any)?.sourceId;
      if (!sourceId) throw new McpError(ErrorCode.InvalidRequest, 'sourceId is required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Build a comprehensive knowledge map of source "${sourceId}".

WORKFLOW:
1. k01_build_graph(sourceId="${sourceId}") to extract entities and relationships
2. k01_get_communities(sourceId="${sourceId}") to see thematic groupings
3. For each community, k01_get_community_detail to understand its contents
4. k01_search_graph to find key entities and explore connections
5. k01_find_path between important entities to trace connections
6. k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="knowledge_map", content=<your synthesis>)

GUIDELINES:
- Identify the main themes and how they relate
- Note which entities bridge multiple communities (connectors)
- Highlight surprising or unexpected relationships
- Summarise each community's role in the overall knowledge structure`,
            },
          },
        ],
      };
    }

    case 'k01_cross_source_synthesis': {
      const sourceId1 = (args as any)?.sourceId1;
      const sourceId2 = (args as any)?.sourceId2;
      if (!sourceId1 || !sourceId2) throw new McpError(ErrorCode.InvalidRequest, 'sourceId1 and sourceId2 are required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Synthesise knowledge across two sources: "${sourceId1}" and "${sourceId2}".

WORKFLOW:
1. Ensure both sources have knowledge graphs: k01_build_graph for each
2. k01_link_sources(sourceId1="${sourceId1}", sourceId2="${sourceId2}") to find connections
3. k01_search_graph to find entities appearing in both sources
4. For shared entities, k01_get_entity_detail to compare treatments
5. Identify contradictions, agreements, and unique contributions from each source
6. k01_save_analysis(sourceId="${sourceId1}", scopeId="full", analysisType="cross_source_synthesis", content=<your synthesis>)

GUIDELINES:
- Compare how each source defines and uses shared concepts
- Note where sources agree, disagree, or complement each other
- Identify unique contributions from each source
- Highlight entities that are important in one source but absent in the other`,
            },
          },
        ],
      };
    }

    // ── Phase 5: Recursive Analysis Prompts ─────────
    case 'k01_recursive_deep_analysis': {
      const sourceId = (args as any)?.sourceId;
      if (!sourceId) throw new McpError(ErrorCode.InvalidRequest, 'sourceId is required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are performing a recursive deep analysis of a large document using K-01.

SETUP:
1. k01_create_analysis_plan(sourceId="${sourceId}") to generate the decomposition plan
2. Review the plan: k01_get_analysis_plan(planId=<returned planId>)

EXECUTION LOOP:
3. k01_get_next_task(planId=<planId>) to get the next task
4. If LEAF task:
   - Read the content using k01_read_section or k01_read_range as instructed
   - Analyse thoroughly: key arguments, evidence, themes, questions, insights
   - Assign a confidence score (0.0-1.0)
   - k01_complete_task(planId, taskId, analysis=<your analysis>, confidence=<score>)
5. If SYNTHESIS task:
   - Review child analyses provided
   - Synthesise: common themes, contradictions, progression of argument
   - Note any low-confidence children
   - k01_complete_task(planId, taskId, analysis=<your synthesis>, confidence=<score>)
6. Repeat from step 3 until plan is complete

COMPLETION:
7. k01_get_summary_tree(sourceId="${sourceId}") to review the full hierarchical summary
8. k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="final_synthesis", content=<your ultimate comprehensive analysis>)`,
            },
          },
        ],
      };
    }

    case 'k01_targeted_deep_dive': {
      const sourceId = (args as any)?.sourceId;
      const focusArea = (args as any)?.focusArea || 'general';
      if (!sourceId) throw new McpError(ErrorCode.InvalidRequest, 'sourceId is required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Perform a targeted deep dive on "${focusArea}" in source "${sourceId}".

WORKFLOW:
1. k01_query_at_level(sourceId="${sourceId}", query="${focusArea}", level=1) to find relevant high-level sections
2. k01_query_at_level(sourceId="${sourceId}", query="${focusArea}", level=0) to get detailed content in those areas
3. Read additional context with k01_read_section as needed
4. Cross-reference with k01_search_graph(query="${focusArea}") for related entities
5. k01_save_analysis(sourceId="${sourceId}", scopeId="full", analysisType="deep_dive", content=<your focused analysis>, tags=["${focusArea}"])`,
            },
          },
        ],
      };
    }

    // ── Phase 6: Final Prompts ──────────────────────
    case 'k01_full_book_analysis': {
      const filePath = (args as any)?.filePath;
      if (!filePath) throw new McpError(ErrorCode.InvalidRequest, 'filePath is required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are a knowledge worker performing a comprehensive analysis of a large book using K-01.

STEP 1 — INGEST:
k01_ingest_document(filePath="${filePath}")

STEP 2 — SURVEY:
k01_get_structure(sourceId=<docId>) to see the full outline
k01_get_info(sourceId=<docId>) for document statistics

STEP 3 — RECURSIVE ANALYSIS:
k01_create_analysis_plan(sourceId=<docId>) to decompose the book
Execute the plan: k01_get_next_task → analyse → k01_complete_task (repeat until done)

STEP 4 — KNOWLEDGE GRAPH:
k01_build_graph(sourceId=<docId>) to extract entities and relationships
k01_get_communities(sourceId=<docId>) to identify thematic clusters

STEP 5 — SYNTHESIS:
k01_get_summary_tree(sourceId=<docId>) for the hierarchical summary
k01_save_analysis(sourceId=<docId>, scopeId="full", analysisType="final_synthesis", content=<comprehensive understanding>)

STEP 6 — EXPORT:
k01_export_report(sourceId=<docId>, format="markdown") to produce a standalone analysis report`,
            },
          },
        ],
      };
    }

    case 'k01_multi_paper_synthesis': {
      const filePaths = (args as any)?.filePaths;
      if (!filePaths) throw new McpError(ErrorCode.InvalidRequest, 'filePaths is required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Synthesise knowledge across multiple research papers:

STEP 1: Ingest all papers:
${filePaths.split(',').map((p: string) => `  k01_ingest_document(filePath="${p.trim()}")`).join('\n')}

STEP 2: Build graphs for each paper: k01_build_graph(sourceId=<each docId>)

STEP 3: Create a collection: k01_create_collection(name="Research Papers", sourceIds=[<all docIds>])

STEP 4: Find shared concepts: k01_link_sources for each pair of papers

STEP 5: Compare treatments: k01_compare_treatments(collectionId=<colId>, entityName=<key concept>)

STEP 6: Find contradictions: k01_find_contradictions(collectionId=<colId>)

STEP 7: Find agreements: k01_find_agreements(collectionId=<colId>)

STEP 8: Generate synthesis: k01_generate_synthesis(collectionId=<colId>, synthesisType="comparison")

STEP 9: Export: k01_export_collection_report(collectionId=<colId>, format="markdown")`,
            },
          },
        ],
      };
    }

    case 'k01_codebase_deep_understanding': {
      const projectPath = (args as any)?.projectPath;
      if (!projectPath) throw new McpError(ErrorCode.InvalidRequest, 'projectPath is required');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Build comprehensive understanding of a large codebase:

STEP 1: k01_ingest_project(rootPath="${projectPath}")

STEP 2: k01_get_structure(sourceId=<projId>) to see file tree and module layout

STEP 3: k01_build_graph(sourceId=<projId>) to extract code entities and relationships

STEP 4: k01_get_communities(sourceId=<projId>) to identify module clusters

STEP 5: For each major module:
  - k01_get_symbols(sourceId=<projId>, filePath=<key file>) to see exported API
  - k01_read_file(sourceId=<projId>, filePath=<key file>) for key files
  - k01_get_call_graph(sourceId=<projId>, symbolName=<core function>)
  - k01_save_analysis(sourceId=<projId>, scopeId=<module>, analysisType="module_analysis", content=<analysis>)

STEP 6: k01_get_impact(sourceId=<projId>, symbolName=<critical function>) for critical functions

STEP 7: k01_save_analysis(sourceId=<projId>, scopeId="full", analysisType="architecture", content=<full architecture analysis>)

STEP 8: k01_export_report(sourceId=<projId>, format="markdown") with full analysis`,
            },
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
});

// ─── Resources ───────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Array<{ uri: string; name: string; description: string; mimeType: string }> = [
    {
      uri: 'k01://documents',
      name: 'K-01 Documents',
      description: 'List of all ingested documents',
      mimeType: 'application/json',
    },
    {
      uri: 'k01://projects',
      name: 'K-01 Projects',
      description: 'List of all ingested projects',
      mimeType: 'application/json',
    },
  ];

  // Phase 2: Per-source analysis and session resources
  const allSourceIds = [...docStore.listDocuments(), ...projectStore.listProjects()];
  for (const srcId of allSourceIds) {
    const analyses = analysisStore.list(srcId);
    if (analyses.length > 0) {
      resources.push({
        uri: `k01://source/${srcId}/analyses`,
        name: `Analyses: ${srcId.substring(0, 8)}...`,
        description: `All analyses for source ${srcId}`,
        mimeType: 'application/json',
      });
    }

    const session = sessionStore.getBySource(srcId);
    if (session) {
      resources.push({
        uri: `k01://source/${srcId}/session`,
        name: `Session: ${srcId.substring(0, 8)}...`,
        description: `Current session state for source ${srcId}`,
        mimeType: 'application/json',
      });
    }
  }

  // Add per-document outline resources
  for (const docId of docStore.listDocuments()) {
    try {
      const meta = docStore.loadMeta(docId);
      resources.push({
        uri: `k01://document/${docId}/outline`,
        name: `Outline: ${meta.title}`,
        description: `Document outline for "${meta.title}"`,
        mimeType: 'text/plain',
      });
    } catch { /* skip broken entries */ }
  }

  // Add per-project tree resources
  for (const projId of projectStore.listProjects()) {
    try {
      const meta = projectStore.loadMeta(projId);
      resources.push({
        uri: `k01://project/${projId}/tree`,
        name: `File tree: ${meta.name}`,
        description: `File tree for project "${meta.name}"`,
        mimeType: 'text/plain',
      });
    } catch { /* skip broken entries */ }
  }

  // Phase 4: Graph resources
  for (const srcId of allSourceIds) {
    const entityCount = graphStore.countEntities(srcId);
    if (entityCount > 0) {
      resources.push({
        uri: `k01://graph/${srcId}/stats`,
        name: `Graph stats: ${srcId.substring(0, 8)}...`,
        description: `Entity and relationship counts for source ${srcId}`,
        mimeType: 'application/json',
      });
      resources.push({
        uri: `k01://graph/${srcId}/communities`,
        name: `Communities: ${srcId.substring(0, 8)}...`,
        description: `Community list for source ${srcId}`,
        mimeType: 'application/json',
      });
    }
  }

  // Phase 4: Cross-links resource
  resources.push({
    uri: 'k01://graph/cross-links',
    name: 'Cross-Source Links',
    description: 'All cross-source entity links',
    mimeType: 'application/json',
  });

  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'k01://documents') {
    const docs = docStore.listDocuments().map((id) => {
      try {
        const meta = docStore.loadMeta(id);
        return { id, title: meta.title, type: meta.sourceType, lines: meta.totalLines, words: meta.totalWords };
      } catch {
        return { id, title: 'Unknown', type: 'unknown', lines: 0, words: 0 };
      }
    });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(docs, null, 2) }] };
  }

  if (uri === 'k01://projects') {
    const projs = projectStore.listProjects().map((id) => {
      try {
        const meta = projectStore.loadMeta(id);
        return { id, name: meta.name, files: meta.totalFiles, lines: meta.totalLines, languages: meta.languages };
      } catch {
        return { id, name: 'Unknown', files: 0, lines: 0, languages: {} };
      }
    });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(projs, null, 2) }] };
  }

  // k01://source/{id}/analyses
  const analysesMatch = uri.match(/^k01:\/\/source\/([^/]+)\/analyses$/);
  if (analysesMatch) {
    const srcId = analysesMatch[1];
    const analyses = analysisStore.list(srcId);
    const data = analyses.map((a) => ({
      id: a.id,
      scopeId: a.scopeId,
      analysisType: a.analysisType,
      version: a.metadata.version,
      tags: a.metadata.tags,
      confidence: a.metadata.confidence,
      updatedAt: a.updatedAt,
      contentPreview: a.content.substring(0, 200) + (a.content.length > 200 ? '...' : ''),
    }));
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }

  // k01://source/{id}/session
  const sessionMatch = uri.match(/^k01:\/\/source\/([^/]+)\/session$/);
  if (sessionMatch) {
    const srcId = sessionMatch[1];
    const session = sessionStore.getBySource(srcId);
    if (!session) {
      throw new McpError(ErrorCode.InvalidRequest, `No session found for source: ${srcId}`);
    }
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(session, null, 2) }] };
  }

  // k01://source/{id}/analysis/{scopeId}/{type}
  const analysisMatch = uri.match(/^k01:\/\/source\/([^/]+)\/analysis\/([^/]+)\/([^/]+)$/);
  if (analysisMatch) {
    const [, srcId, scopeId, analysisType] = analysisMatch;
    const entry = analysisStore.get(srcId, decodeURIComponent(scopeId), decodeURIComponent(analysisType));
    if (!entry) {
      throw new McpError(ErrorCode.InvalidRequest, `Analysis not found: ${scopeId}/${analysisType}`);
    }
    return { contents: [{ uri, mimeType: 'text/plain', text: entry.content }] };
  }

  // k01://document/{id}/outline
  const docOutlineMatch = uri.match(/^k01:\/\/document\/([^/]+)\/outline$/);
  if (docOutlineMatch) {
    const docId = docOutlineMatch[1];
    const structure = docStore.loadStructure(docId);
    return { contents: [{ uri, mimeType: 'text/plain', text: structure.outline }] };
  }

  // k01://project/{id}/tree
  const projTreeMatch = uri.match(/^k01:\/\/project\/([^/]+)\/tree$/);
  if (projTreeMatch) {
    const projId = projTreeMatch[1];
    const structure = projectStore.loadStructure(projId);
    const treeText = formatFileTree(structure.fileTree);
    return { contents: [{ uri, mimeType: 'text/plain', text: treeText }] };
  }

  // Phase 4: Graph stats
  const graphStatsMatch = uri.match(/^k01:\/\/graph\/([^/]+)\/stats$/);
  if (graphStatsMatch) {
    const srcId = graphStatsMatch[1];
    const entityStats = graphStore.getEntityStats(srcId);
    const relStats = graphStore.getRelationshipStats(srcId);
    const communities = graphStore.getCommunities({ sourceId: srcId });
    return {
      contents: [{
        uri, mimeType: 'application/json',
        text: JSON.stringify({ entityStats, relationshipStats: relStats, communityCount: communities.length }, null, 2),
      }],
    };
  }

  // Phase 4: Graph communities
  const graphCommMatch = uri.match(/^k01:\/\/graph\/([^/]+)\/communities$/);
  if (graphCommMatch) {
    const srcId = graphCommMatch[1];
    const communities = graphStore.getCommunities({ sourceId: srcId });
    return {
      contents: [{
        uri, mimeType: 'application/json',
        text: JSON.stringify(communities, null, 2),
      }],
    };
  }

  // Phase 4: Cross-links
  if (uri === 'k01://graph/cross-links') {
    // Get all relationships of type same_as or related_to that cross sources
    const allRels = graphStore.getRelationships({ type: 'same_as', limit: 200 });
    const relatedRels = graphStore.getRelationships({ type: 'related_to', limit: 200 });
    const links = [...allRels, ...relatedRels].map((r) => {
      const src = graphStore.getEntity(r.sourceEntityId);
      const tgt = graphStore.getEntity(r.targetEntityId);
      return {
        sourceEntity: src?.name, sourceSource: src?.sourceId,
        targetEntity: tgt?.name, targetSource: tgt?.sourceId,
        type: r.type, weight: r.weight, description: r.description,
      };
    }).filter((l) => l.sourceSource !== l.targetSource);

    return {
      contents: [{
        uri, mimeType: 'application/json',
        text: JSON.stringify(links, null, 2),
      }],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
});

function formatFileTree(nodes: any[], indent: string = ''): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type === 'directory') {
      lines.push(`${indent}📁 ${node.path.split('/').pop()}/`);
      if (node.children) {
        lines.push(formatFileTree(node.children, indent + '  '));
      }
    } else {
      const lang = node.language ? ` [${node.language}]` : '';
      const size = node.size ? ` (${(node.size / 1024).toFixed(1)}KB)` : '';
      lines.push(`${indent}📄 ${node.path.split('/').pop()}${lang}${size}`);
    }
  }
  return lines.join('\n');
}

function formatTaskTree(node: AnalysisTaskNode, indent: number): string {
  const prefix = '  '.repeat(indent);
  const status = node.status === 'complete' ? '✅' : node.status === 'in_progress' ? '🔄' : '⬜';
  const conf = node.confidence !== undefined ? ` (${node.confidence.toFixed(2)})` : '';
  const line = `${prefix}${status} [${node.type}] ${node.scopeDescription} (~${node.wordCount}w)${conf}`;
  const childLines = node.children.map((c) => formatTaskTree(c, indent + 1));
  return [line, ...childLines].join('\n');
}

function findTaskInTree(node: AnalysisTaskNode, taskId: string): AnalysisTaskNode | null {
  if (node.id === taskId) return node;
  for (const child of node.children) {
    const found = findTaskInTree(child, taskId);
    if (found) return found;
  }
  return null;
}

// ─── Start ───────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('K-01 MCP server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb();
  process.exit(1);
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
