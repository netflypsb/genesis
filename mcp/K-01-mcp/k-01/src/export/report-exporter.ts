import * as fs from 'fs';
import * as path from 'path';
import type { K01Config } from '../config.js';
import type { DocumentStore } from '../store/document-store.js';
import type { ProjectStore } from '../store/project-store.js';
import type { AnalysisStore } from '../store/analysis-store.js';
import type { GraphStore } from '../graph/graph-store.js';
import type { SummaryTree } from '../recursive/summary-tree.js';
import type { ExportedKnowledge } from '../types.js';

export class ReportExporter {
  private config: K01Config;
  private docStore: DocumentStore;
  private projectStore: ProjectStore;
  private analysisStore: AnalysisStore;
  private graphStore: GraphStore;
  private summaryTree: SummaryTree;

  constructor(
    config: K01Config,
    docStore: DocumentStore,
    projectStore: ProjectStore,
    analysisStore: AnalysisStore,
    graphStore: GraphStore,
    summaryTree: SummaryTree,
  ) {
    this.config = config;
    this.docStore = docStore;
    this.projectStore = projectStore;
    this.analysisStore = analysisStore;
    this.graphStore = graphStore;
    this.summaryTree = summaryTree;
  }

  exportMarkdown(sourceId: string, opts?: {
    includeAnalyses?: boolean;
    includeGraph?: boolean;
    includeSummaryTree?: boolean;
  }): string {
    const includeAnalyses = opts?.includeAnalyses ?? true;
    const includeGraph = opts?.includeGraph ?? true;
    const includeSummaryTree = opts?.includeSummaryTree ?? true;

    const isDoc = this.docStore.exists(sourceId);
    const isProj = this.projectStore.exists(sourceId);

    let title = sourceId;
    let sourceType = 'unknown';
    let stats = '';

    if (isDoc) {
      const meta = this.docStore.loadMeta(sourceId);
      title = meta.title;
      sourceType = meta.sourceType;
      stats = `- **Lines**: ${meta.totalLines}\n- **Words**: ${meta.totalWords}`;
    } else if (isProj) {
      const meta = this.projectStore.loadMeta(sourceId);
      title = meta.name;
      sourceType = 'codebase';
      stats = `- **Root**: ${meta.rootPath}\n- **Files**: ${meta.totalFiles}\n- **Lines**: ${meta.totalLines}`;
    }

    const parts: string[] = [];

    parts.push(`# Analysis Report: ${title}\n`);
    parts.push(`## Document Overview`);
    parts.push(`- **Source ID**: \`${sourceId}\``);
    parts.push(`- **Type**: ${sourceType}`);
    parts.push(stats);
    parts.push(`- **Exported**: ${new Date().toISOString()}\n`);

    // Executive Summary
    if (includeSummaryTree) {
      const tree = this.summaryTree.getSummaryTree(sourceId);
      if (tree.totalLevels > 0) {
        const topLevel = tree.levels[tree.levels.length - 1];
        parts.push(`## Executive Summary\n`);
        for (const node of topLevel.nodes) {
          parts.push(node.summary);
        }
        parts.push('');
      }
    }

    // Analyses
    if (includeAnalyses) {
      const analyses = this.analysisStore.list(sourceId);
      if (analyses.length > 0) {
        parts.push(`## Detailed Analysis\n`);
        for (const a of analyses) {
          parts.push(`### ${a.analysisType}: ${a.scopeId}`);
          if (a.metadata?.confidence !== undefined) parts.push(`_Confidence: ${a.metadata.confidence.toFixed(2)}_\n`);
          parts.push(a.content);
          parts.push('');
        }
      }
    }

    // Knowledge Graph
    if (includeGraph) {
      const entities = this.graphStore.getEntities({ sourceId, limit: 200 });
      if (entities.length > 0) {
        parts.push(`## Knowledge Graph\n`);

        parts.push(`### Key Entities (${entities.length})\n`);
        const byType = new Map<string, typeof entities>();
        for (const e of entities) {
          if (!byType.has(e.type)) byType.set(e.type, []);
          byType.get(e.type)!.push(e);
        }
        for (const [type, ents] of byType) {
          parts.push(`#### ${type} (${ents.length})`);
          for (const e of ents.slice(0, 20)) {
            parts.push(`- **${e.name}**${e.description ? ': ' + e.description : ''}`);
          }
          if (ents.length > 20) parts.push(`_...and ${ents.length - 20} more_`);
          parts.push('');
        }

        const communities = this.graphStore.getCommunities({ sourceId });
        if (communities.length > 0) {
          parts.push(`### Thematic Communities (${communities.length})\n`);
          for (const c of communities) {
            parts.push(`- **${c.title || `Community ${c.id.substring(0, 8)}`}**${c.summary ? ': ' + c.summary : ''} (${c.entityCount} entities)`);
          }
          parts.push('');
        }
      }
    }

    // Summary Tree
    if (includeSummaryTree) {
      const tree = this.summaryTree.getSummaryTree(sourceId);
      if (tree.totalLevels > 0) {
        parts.push(`## Hierarchical Summary Tree\n`);
        for (const lvl of tree.levels) {
          parts.push(`### Level ${lvl.level} (${lvl.nodes.length} nodes)\n`);
          for (const n of lvl.nodes) {
            const conf = n.confidence !== undefined ? ` _(${n.confidence.toFixed(2)})_` : '';
            parts.push(`#### ${n.title}${conf}\n${n.summary}\n`);
          }
        }
      }
    }

    const content = parts.join('\n');

    // Write to export directory
    const exportDir = path.join(this.config.baseDir, 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}_report.md`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
  }

  exportJson(sourceId: string): string {
    const isDoc = this.docStore.exists(sourceId);
    const isProj = this.projectStore.exists(sourceId);

    let source: any;
    let structure: any;

    if (isDoc) {
      source = this.docStore.loadMeta(sourceId);
      structure = this.docStore.loadStructure(sourceId);
    } else if (isProj) {
      source = this.projectStore.loadMeta(sourceId);
      structure = this.projectStore.loadStructure(sourceId);
    } else {
      throw new Error(`Source not found: ${sourceId}`);
    }

    const analyses = this.analysisStore.list(sourceId);
    const summaryTreeData = this.summaryTree.getSummaryTree(sourceId);
    const entities = this.graphStore.getEntities({ sourceId, limit: 10000 });
    // Get relationships via entity IDs
    const entityIds = new Set(entities.map((e) => e.id));
    const allRels = this.graphStore.getRelationships({ limit: 50000 });
    const relationships = allRels.filter((r) => entityIds.has(r.sourceEntityId) || entityIds.has(r.targetEntityId));
    const communities = this.graphStore.getCommunities({ sourceId });

    const exported: ExportedKnowledge = {
      source,
      structure,
      analyses,
      summaryTree: summaryTreeData.totalLevels > 0 ? summaryTreeData : null,
      graph: { entities, relationships, communities },
      exportedAt: new Date().toISOString(),
    };

    const exportDir = path.join(this.config.baseDir, 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const title = isDoc ? source.title : source.name;
    const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}_export.json`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(exported, null, 2), 'utf-8');

    return filePath;
  }

  exportGraph(sourceId: string | undefined, format: 'json' | 'graphml' | 'csv'): string {
    const entities = sourceId
      ? this.graphStore.getEntities({ sourceId, limit: 10000 })
      : this.graphStore.getEntities({ limit: 10000 });
    let relationships;
    if (sourceId) {
      const entityIds = new Set(entities.map((e) => e.id));
      const allRels = this.graphStore.getRelationships({ limit: 50000 });
      relationships = allRels.filter((r) => entityIds.has(r.sourceEntityId) || entityIds.has(r.targetEntityId));
    } else {
      relationships = this.graphStore.getRelationships({ limit: 50000 });
    }

    const exportDir = path.join(this.config.baseDir, 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const prefix = sourceId ? sourceId.substring(0, 8) : 'all';

    if (format === 'json') {
      const filePath = path.join(exportDir, `${prefix}_graph.json`);
      fs.writeFileSync(filePath, JSON.stringify({ entities, relationships }, null, 2), 'utf-8');
      return filePath;
    }

    if (format === 'graphml') {
      const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphstruct.org/graphml">',
        '  <key id="name" for="node" attr.name="name" attr.type="string"/>',
        '  <key id="type" for="node" attr.name="type" attr.type="string"/>',
        '  <key id="desc" for="node" attr.name="description" attr.type="string"/>',
        '  <key id="reltype" for="edge" attr.name="type" attr.type="string"/>',
        '  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>',
        '  <graph edgedefault="directed">',
      ];
      for (const e of entities) {
        lines.push(`    <node id="${escapeXml(e.id)}">`);
        lines.push(`      <data key="name">${escapeXml(e.name)}</data>`);
        lines.push(`      <data key="type">${escapeXml(e.type)}</data>`);
        if (e.description) lines.push(`      <data key="desc">${escapeXml(e.description)}</data>`);
        lines.push(`    </node>`);
      }
      for (const r of relationships) {
        lines.push(`    <edge source="${escapeXml(r.sourceEntityId)}" target="${escapeXml(r.targetEntityId)}">`);
        lines.push(`      <data key="reltype">${escapeXml(r.type)}</data>`);
        lines.push(`      <data key="weight">${r.weight}</data>`);
        lines.push(`    </edge>`);
      }
      lines.push('  </graph>', '</graphml>');

      const filePath = path.join(exportDir, `${prefix}_graph.graphml`);
      fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
      return filePath;
    }

    // CSV
    const nodesFile = path.join(exportDir, `${prefix}_nodes.csv`);
    const edgesFile = path.join(exportDir, `${prefix}_edges.csv`);

    const nodeLines = ['id,name,type,source_id,description'];
    for (const e of entities) {
      nodeLines.push(`"${csvEscape(e.id)}","${csvEscape(e.name)}","${csvEscape(e.type)}","${csvEscape(e.sourceId)}","${csvEscape(e.description || '')}"`);
    }
    fs.writeFileSync(nodesFile, nodeLines.join('\n'), 'utf-8');

    const edgeLines = ['source,target,type,weight,description'];
    for (const r of relationships) {
      edgeLines.push(`"${csvEscape(r.sourceEntityId)}","${csvEscape(r.targetEntityId)}","${csvEscape(r.type)}",${r.weight},"${csvEscape(r.description || '')}"`);
    }
    fs.writeFileSync(edgesFile, edgeLines.join('\n'), 'utf-8');

    return `${nodesFile} + ${edgesFile}`;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvEscape(s: string): string {
  return s.replace(/"/g, '""');
}
