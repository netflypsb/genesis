import type { GraphEntity, CrossSourceLink } from '../types.js';
import { GraphStore } from './graph-store.js';

export class CrossSourceLinker {
  private graphStore: GraphStore;

  constructor(graphStore: GraphStore) {
    this.graphStore = graphStore;
  }

  linkSources(sourceId1: string, sourceId2: string): CrossSourceLink[] {
    const entities1 = this.graphStore.getEntities({ sourceId: sourceId1 });
    const entities2 = this.graphStore.getEntities({ sourceId: sourceId2 });

    const links: CrossSourceLink[] = [];

    for (const e1 of entities1) {
      for (const e2 of entities2) {
        const link = this.tryLink(e1, e2);
        if (link) {
          links.push(link);

          // Create a 'same_as' or 'related_to' relationship in the graph
          this.graphStore.saveRelationship(
            e1.id,
            e2.id,
            link.linkType,
            link.evidence,
            link.confidence,
          );
        }
      }
    }

    return links;
  }

  private tryLink(e1: GraphEntity, e2: GraphEntity): CrossSourceLink | null {
    // 1. Exact name match (case-insensitive)
    if (e1.name.toLowerCase() === e2.name.toLowerCase()) {
      return {
        entityId1: e1.id,
        entityId2: e2.id,
        linkType: 'same_as',
        confidence: 0.95,
        evidence: `Exact name match: "${e1.name}"`,
      };
    }

    // 2. Acronym expansion match
    const acronymLink = this.checkAcronymMatch(e1, e2);
    if (acronymLink) return acronymLink;

    // 3. Substring containment (one name contains the other)
    const n1 = e1.name.toLowerCase();
    const n2 = e2.name.toLowerCase();
    if (n1.length > 3 && n2.length > 3) {
      if (n1.includes(n2) || n2.includes(n1)) {
        return {
          entityId1: e1.id,
          entityId2: e2.id,
          linkType: 'related_to',
          confidence: 0.7,
          evidence: `Name containment: "${e1.name}" ↔ "${e2.name}"`,
        };
      }
    }

    // 4. Same type + high word overlap
    if (e1.type === e2.type) {
      const overlap = this.wordOverlap(e1.name, e2.name);
      if (overlap >= 0.6) {
        return {
          entityId1: e1.id,
          entityId2: e2.id,
          linkType: 'related_to',
          confidence: overlap * 0.8,
          evidence: `Word overlap (${(overlap * 100).toFixed(0)}%): "${e1.name}" ↔ "${e2.name}"`,
        };
      }
    }

    return null;
  }

  private checkAcronymMatch(e1: GraphEntity, e2: GraphEntity): CrossSourceLink | null {
    // Check if one is an acronym of the other
    const isAcronym = (short: string, long: string): boolean => {
      if (short.length < 2 || short.length > 6) return false;
      if (short !== short.toUpperCase()) return false;
      const words = long.split(/\s+/).filter((w) => w.length > 0);
      if (words.length < short.length) return false;
      const initials = words.map((w) => w[0].toUpperCase()).join('');
      return initials.startsWith(short) || initials.includes(short);
    };

    if (isAcronym(e1.name, e2.name)) {
      return {
        entityId1: e1.id,
        entityId2: e2.id,
        linkType: 'same_as',
        confidence: 0.85,
        evidence: `Acronym match: "${e1.name}" ↔ "${e2.name}"`,
      };
    }

    if (isAcronym(e2.name, e1.name)) {
      return {
        entityId1: e1.id,
        entityId2: e2.id,
        linkType: 'same_as',
        confidence: 0.85,
        evidence: `Acronym match: "${e2.name}" ↔ "${e1.name}"`,
      };
    }

    return null;
  }

  private wordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }

    return overlap / Math.max(wordsA.size, wordsB.size);
  }
}
