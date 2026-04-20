import type { GraphStore } from '../graph/graph-store.js';
import type { AnalysisStore } from '../store/analysis-store.js';
import type { GraphEntity, GraphRelationship } from '../types.js';

export interface CrossSearchResult {
  entityId: string;
  name: string;
  type: string;
  sourceId: string;
  description?: string;
  relevance: number;
}

export interface TreatmentComparison {
  entityName: string;
  treatments: Array<{
    sourceId: string;
    entityId: string;
    description: string;
    relationships: Array<{ type: string; targetName: string; description?: string }>;
  }>;
}

export interface ConflictPair {
  sourceA: string;
  sourceB: string;
  entityA: string;
  entityB: string;
  descriptionA: string;
  descriptionB: string;
  reason: string;
}

export interface AgreementCluster {
  concept: string;
  sources: string[];
  descriptions: Array<{ sourceId: string; description: string }>;
}

export class CrossSearch {
  private graphStore: GraphStore;
  private analysisStore: AnalysisStore;

  constructor(graphStore: GraphStore, analysisStore: AnalysisStore) {
    this.graphStore = graphStore;
    this.analysisStore = analysisStore;
  }

  search(sourceIds: string[], query: string, entityTypes?: string[], limit: number = 50): CrossSearchResult[] {
    const results: CrossSearchResult[] = [];

    for (const srcId of sourceIds) {
      const entities = this.graphStore.searchEntities(query, { sourceId: srcId });
      for (const e of entities) {
        if (entityTypes && entityTypes.length > 0 && !entityTypes.includes(e.type)) continue;
        results.push({
          entityId: e.id,
          name: e.name,
          type: e.type,
          sourceId: e.sourceId,
          description: e.description,
          relevance: this.computeRelevance(e, query),
        });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  compareTreatments(sourceIds: string[], entityName: string): TreatmentComparison {
    const treatments: TreatmentComparison['treatments'] = [];
    const lowerName = entityName.toLowerCase();

    for (const srcId of sourceIds) {
      const entities = this.graphStore.searchEntities(entityName, { sourceId: srcId });
      const match = entities.find((e) => e.name.toLowerCase() === lowerName)
        || entities[0];

      if (!match) continue;

      const rels = this.graphStore.getRelationships({ entityId: match.id, limit: 50 });
      const relDetails = rels.map((r) => {
        const target = r.sourceEntityId === match.id
          ? this.graphStore.getEntity(r.targetEntityId)
          : this.graphStore.getEntity(r.sourceEntityId);
        return {
          type: r.type,
          targetName: target?.name || 'unknown',
          description: r.description,
        };
      });

      treatments.push({
        sourceId: srcId,
        entityId: match.id,
        description: match.description || '',
        relationships: relDetails,
      });
    }

    return { entityName, treatments };
  }

  findContradictions(sourceIds: string[]): ConflictPair[] {
    const conflicts: ConflictPair[] = [];
    const entityMap = new Map<string, Array<{ sourceId: string; entity: GraphEntity }>>();

    // Group entities by normalized name across sources
    for (const srcId of sourceIds) {
      const entities = this.graphStore.getEntities({ sourceId: srcId, limit: 500 });
      for (const e of entities) {
        const key = e.name.toLowerCase().trim();
        if (!entityMap.has(key)) entityMap.set(key, []);
        entityMap.get(key)!.push({ sourceId: srcId, entity: e });
      }
    }

    // Find same-name entities from different sources with divergent descriptions
    for (const [, entries] of entityMap) {
      if (entries.length < 2) continue;

      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];
          if (a.sourceId === b.sourceId) continue;
          if (!a.entity.description || !b.entity.description) continue;

          // Simple heuristic: if descriptions share < 30% words, may be contradictory
          const similarity = this.wordOverlap(a.entity.description, b.entity.description);
          if (similarity < 0.3 && a.entity.description.length > 20 && b.entity.description.length > 20) {
            conflicts.push({
              sourceA: a.sourceId,
              sourceB: b.sourceId,
              entityA: a.entity.name,
              entityB: b.entity.name,
              descriptionA: a.entity.description,
              descriptionB: b.entity.description,
              reason: `Low description overlap (${(similarity * 100).toFixed(0)}%) — potential divergent treatment`,
            });
          }
        }
      }
    }

    return conflicts;
  }

  findAgreements(sourceIds: string[]): AgreementCluster[] {
    const clusters: AgreementCluster[] = [];
    const entityMap = new Map<string, Array<{ sourceId: string; entity: GraphEntity }>>();

    for (const srcId of sourceIds) {
      const entities = this.graphStore.getEntities({ sourceId: srcId, limit: 500 });
      for (const e of entities) {
        const key = e.name.toLowerCase().trim();
        if (!entityMap.has(key)) entityMap.set(key, []);
        entityMap.get(key)!.push({ sourceId: srcId, entity: e });
      }
    }

    for (const [concept, entries] of entityMap) {
      // Need at least 2 distinct sources
      const uniqueSources = [...new Set(entries.map((e) => e.sourceId))];
      if (uniqueSources.length < 2) continue;

      // High word overlap = agreement
      const descriptions = entries.filter((e) => e.entity.description && e.entity.description.length > 10);
      if (descriptions.length >= 2) {
        let allAgree = true;
        for (let i = 0; i < descriptions.length - 1 && allAgree; i++) {
          const sim = this.wordOverlap(descriptions[i].entity.description!, descriptions[i + 1].entity.description!);
          if (sim < 0.3) allAgree = false;
        }

        if (allAgree || uniqueSources.length >= 3) {
          clusters.push({
            concept,
            sources: uniqueSources,
            descriptions: entries.map((e) => ({
              sourceId: e.sourceId,
              description: e.entity.description || e.entity.name,
            })),
          });
        }
      }
    }

    return clusters.sort((a, b) => b.sources.length - a.sources.length);
  }

  private computeRelevance(entity: GraphEntity, query: string): number {
    const lowerQuery = query.toLowerCase();
    const lowerName = entity.name.toLowerCase();
    const lowerDesc = (entity.description || '').toLowerCase();

    let score = 0;
    if (lowerName === lowerQuery) score += 1.0;
    else if (lowerName.includes(lowerQuery)) score += 0.7;
    if (lowerDesc.includes(lowerQuery)) score += 0.3;

    return score;
  }

  private wordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
  }
}
