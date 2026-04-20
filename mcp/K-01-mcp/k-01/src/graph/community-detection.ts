// Louvain modularity optimisation for community detection
// Lightweight implementation — no external dependencies

export interface LouvainResult {
  communities: Map<string, string>; // nodeId → communityId
  modularity: number;
  communityCount: number;
}

export function detectCommunities(adjacency: Map<string, Set<string>>): LouvainResult {
  const nodes = [...adjacency.keys()];
  if (nodes.length === 0) {
    return { communities: new Map(), modularity: 0, communityCount: 0 };
  }

  // Edge count (undirected: count each edge once)
  let totalEdges = 0;
  for (const neighbors of adjacency.values()) {
    totalEdges += neighbors.size;
  }
  totalEdges /= 2; // undirected

  if (totalEdges === 0) {
    // No edges — each node is its own community
    const communities = new Map<string, string>();
    for (const node of nodes) communities.set(node, node);
    return { communities, modularity: 0, communityCount: nodes.length };
  }

  // Initialise: each node in its own community
  const community = new Map<string, string>();
  for (const node of nodes) community.set(node, node);

  // Degree of each node
  const degree = new Map<string, number>();
  for (const [node, neighbors] of adjacency) {
    degree.set(node, neighbors.size);
  }

  const m2 = totalEdges * 2; // 2 * total edges

  // Sum of degrees within each community
  const communityDegreeSum = new Map<string, number>();
  for (const node of nodes) {
    communityDegreeSum.set(node, degree.get(node) || 0);
  }

  // Sum of internal edges within each community
  const communityInternalEdges = new Map<string, number>();
  for (const node of nodes) {
    communityInternalEdges.set(node, 0);
  }

  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (const node of nodes) {
      const currentCommunity = community.get(node)!;
      const nodeDeg = degree.get(node) || 0;

      // Count edges to each neighboring community
      const neighborCommunityEdges = new Map<string, number>();
      const neighbors = adjacency.get(node) || new Set();
      
      for (const neighbor of neighbors) {
        const neighborComm = community.get(neighbor)!;
        neighborCommunityEdges.set(neighborComm, (neighborCommunityEdges.get(neighborComm) || 0) + 1);
      }

      // Try removing node from current community
      const edgesToCurrent = neighborCommunityEdges.get(currentCommunity) || 0;

      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const [targetComm, edgesToTarget] of neighborCommunityEdges) {
        if (targetComm === currentCommunity) continue;

        const sigmaTot = communityDegreeSum.get(targetComm) || 0;
        const sigmaTotCurrent = communityDegreeSum.get(currentCommunity) || 0;

        // Modularity gain of moving node to targetComm
        const gain = (edgesToTarget - edgesToCurrent) / totalEdges
          - nodeDeg * (sigmaTot - sigmaTotCurrent + nodeDeg) / (m2 * m2 / 2);

        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetComm;
        }
      }

      if (bestCommunity !== currentCommunity) {
        // Move node
        community.set(node, bestCommunity);
        communityDegreeSum.set(currentCommunity, (communityDegreeSum.get(currentCommunity) || 0) - nodeDeg);
        communityDegreeSum.set(bestCommunity, (communityDegreeSum.get(bestCommunity) || 0) + nodeDeg);
        improved = true;
      }
    }
  }

  // Calculate final modularity
  const modularity = calculateModularity(adjacency, community, totalEdges);

  // Renumber communities
  const communityMap = new Map<string, string>();
  let commIndex = 0;
  const result = new Map<string, string>();
  for (const [node, comm] of community) {
    if (!communityMap.has(comm)) {
      communityMap.set(comm, `community-${commIndex++}`);
    }
    result.set(node, communityMap.get(comm)!);
  }

  return {
    communities: result,
    modularity,
    communityCount: communityMap.size,
  };
}

function calculateModularity(
  adjacency: Map<string, Set<string>>,
  community: Map<string, string>,
  totalEdges: number,
): number {
  if (totalEdges === 0) return 0;

  const m2 = totalEdges * 2;
  let Q = 0;

  for (const [i, neighbors] of adjacency) {
    const ki = neighbors.size;
    const ci = community.get(i)!;

    for (const j of neighbors) {
      const kj = (adjacency.get(j)?.size) || 0;
      const cj = community.get(j)!;

      if (ci === cj) {
        Q += 1 - (ki * kj) / m2;
      }
    }
  }

  return Q / m2;
}

// Generate a community title from its member entities
export function generateCommunityTitle(
  entityNames: string[],
  entityTypes: string[],
): string {
  if (entityNames.length === 0) return 'Empty Community';

  // Most common type
  const typeCounts = new Map<string, number>();
  for (const t of entityTypes) {
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed';

  // Shortest distinctive name as label
  const sortedNames = [...entityNames].sort((a, b) => a.length - b.length);
  const label = sortedNames[0];

  return `${label} (${topType}, ${entityNames.length} entities)`;
}

export function generateCommunitySummary(
  entityNames: string[],
  entityTypes: string[],
  relationshipTypes: string[],
): string {
  const typeCounts = new Map<string, number>();
  for (const t of entityTypes) typeCounts.set(t, (typeCounts.get(t) || 0) + 1);

  const relCounts = new Map<string, number>();
  for (const t of relationshipTypes) relCounts.set(t, (relCounts.get(t) || 0) + 1);

  const typeStr = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${c} ${t}`)
    .join(', ');

  const relStr = [...relCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, c]) => `${c} ${t}`)
    .join(', ');

  const topNames = entityNames.slice(0, 5).join(', ');
  const moreStr = entityNames.length > 5 ? ` and ${entityNames.length - 5} more` : '';

  return `Community with ${typeStr}. Key entities: ${topNames}${moreStr}. Relationships: ${relStr || 'none'}.`;
}
