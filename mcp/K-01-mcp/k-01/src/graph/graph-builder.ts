import type { K01Config } from '../config.js';
import type { ExtractionResult } from '../types.js';
import { GraphStore } from './graph-store.js';
import { EntityExtractor } from './entity-extractor.js';
import { detectCommunities, generateCommunityTitle, generateCommunitySummary } from './community-detection.js';
import { DocumentStore } from '../store/document-store.js';
import { ProjectStore } from '../store/project-store.js';

export interface BuildGraphResult {
  entitiesExtracted: number;
  relationshipsCreated: number;
  communitiesDetected: number;
  modularity: number;
}

export class GraphBuilder {
  private config: K01Config;
  private graphStore: GraphStore;
  private entityExtractor: EntityExtractor;
  private docStore: DocumentStore;
  private projectStore: ProjectStore;

  constructor(
    config: K01Config,
    graphStore: GraphStore,
    docStore: DocumentStore,
    projectStore: ProjectStore,
  ) {
    this.config = config;
    this.graphStore = graphStore;
    this.entityExtractor = new EntityExtractor();
    this.docStore = docStore;
    this.projectStore = projectStore;
  }

  async buildGraph(sourceId: string, mode: 'rule-based' | 'llm-enhanced' | 'hybrid' = 'rule-based'): Promise<BuildGraphResult> {
    // Clear existing graph data for this source
    this.graphStore.deleteEntitiesForSource(sourceId);

    let extraction: ExtractionResult;

    if (this.docStore.exists(sourceId)) {
      extraction = this.extractFromDocument(sourceId);
    } else if (this.projectStore.exists(sourceId)) {
      extraction = this.extractFromProject(sourceId);
    } else {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // Save entities and build name→id map
    const nameToId = new Map<string, string>();
    for (const entity of extraction.entities) {
      const id = this.graphStore.saveEntity(
        sourceId,
        entity.name,
        entity.type,
        entity.description,
        entity.properties,
        entity.location ? [entity.location] : undefined,
      );
      nameToId.set(entity.name, id);
    }

    // Save relationships
    let relsCreated = 0;
    for (const rel of extraction.relationships) {
      const sourceId2 = nameToId.get(rel.sourceName);
      const targetId = nameToId.get(rel.targetName);
      if (sourceId2 && targetId) {
        this.graphStore.saveRelationship(
          sourceId2,
          targetId,
          rel.type,
          rel.description,
          rel.weight,
        );
        relsCreated++;
      }
    }

    // Run community detection
    const communityResult = this.detectAndSaveCommunities(sourceId);

    return {
      entitiesExtracted: extraction.entities.length,
      relationshipsCreated: relsCreated,
      communitiesDetected: communityResult.communityCount,
      modularity: communityResult.modularity,
    };
  }

  private extractFromDocument(sourceId: string): ExtractionResult {
    const meta = this.docStore.loadMeta(sourceId);
    const structure = this.docStore.loadStructure(sourceId);
    const content = this.docStore.loadMarkdown(sourceId);

    const sections = this.flattenSections(structure.sections);
    return this.entityExtractor.extractFromDocument(content, sourceId, sections);
  }

  private extractFromProject(sourceId: string): ExtractionResult {
    const meta = this.projectStore.loadMeta(sourceId);
    const symbols = meta.structure.symbols || [];

    return this.entityExtractor.extractFromCode(
      symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        filePath: s.filePath,
        startLine: s.startLine,
        endLine: s.endLine,
        calls: (s as any).calls,
        calledBy: (s as any).calledBy,
        imports: (s as any).imports,
      })),
      sourceId,
    );
  }

  private flattenSections(sections: Array<{ id: string; title: string; startLine: number; endLine: number; children?: any[] }>): Array<{ id: string; title: string; startLine: number; endLine: number }> {
    const result: Array<{ id: string; title: string; startLine: number; endLine: number }> = [];
    for (const s of sections) {
      result.push({ id: s.id, title: s.title, startLine: s.startLine, endLine: s.endLine });
      if (s.children) {
        result.push(...this.flattenSections(s.children));
      }
    }
    return result;
  }

  private detectAndSaveCommunities(sourceId: string): { communityCount: number; modularity: number } {
    this.graphStore.clearCommunities(sourceId);

    const adjacency = this.graphStore.getAdjacencyList(sourceId);
    if (adjacency.size === 0) return { communityCount: 0, modularity: 0 };

    const result = detectCommunities(adjacency);

    // Group entities by community
    const communityEntities = new Map<string, string[]>();
    for (const [entityId, communityLabel] of result.communities) {
      if (!communityEntities.has(communityLabel)) {
        communityEntities.set(communityLabel, []);
      }
      communityEntities.get(communityLabel)!.push(entityId);
    }

    // Save communities
    for (const [communityLabel, entityIds] of communityEntities) {
      // Get entity details for title generation
      const entityNames: string[] = [];
      const entityTypes: string[] = [];
      const relTypes: string[] = [];

      for (const eid of entityIds) {
        const entity = this.graphStore.getEntity(eid);
        if (entity) {
          entityNames.push(entity.name);
          entityTypes.push(entity.type);
        }
        // Get relationship types
        const rels = this.graphStore.getRelationships({ entityId: eid, limit: 50 });
        for (const r of rels) relTypes.push(r.type);
      }

      const title = generateCommunityTitle(entityNames, entityTypes);
      const summary = generateCommunitySummary(entityNames, entityTypes, relTypes);

      const commId = this.graphStore.saveCommunity(
        sourceId,
        0,
        title,
        summary,
        entityIds.length,
      );

      // Assign entities to community
      for (const eid of entityIds) {
        this.graphStore.assignCommunity(eid, commId);
      }
    }

    return { communityCount: communityEntities.size, modularity: result.modularity };
  }
}
