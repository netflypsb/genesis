import type { ExtractedEntity, ExtractedRelationship, ExtractionResult, EntityLocation } from '../types.js';

// Rule-based entity extraction — zero LLM cost
export class EntityExtractor {

  // ─── Document Extraction ───────────────────────────

  extractFromDocument(
    markdown: string,
    sourceId: string,
    sections: Array<{ id: string; title: string; startLine: number; endLine: number }>,
  ): ExtractionResult {
    const entities: ExtractedEntity[] = [];
    const relationships: ExtractedRelationship[] = [];
    const lines = markdown.split('\n');

    // 1. Section headings → concept entities
    for (const section of sections) {
      entities.push({
        name: section.title,
        type: 'concept',
        description: `Section heading at level`,
        location: { sourceId, scopeId: section.id, startLine: section.startLine, endLine: section.endLine },
      });
    }

    // 2. Bold/italic terms → candidate entities
    const boldPattern = /\*\*([^*]+)\*\*/g;
    const italicPattern = /\*([^*]+)\*/g;
    const seenTerms = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Bold terms
      let match;
      while ((match = boldPattern.exec(line)) !== null) {
        const term = match[1].trim();
        if (term.length > 2 && term.length < 80 && !seenTerms.has(term.toLowerCase())) {
          seenTerms.add(term.toLowerCase());
          entities.push({
            name: term,
            type: 'term',
            description: `Emphasised term`,
            location: { sourceId, scopeId: this.findSection(i, sections), startLine: i },
          });
        }
      }
      boldPattern.lastIndex = 0;

      // Italic terms (only standalone, not within bold)
      while ((match = italicPattern.exec(line)) !== null) {
        const term = match[1].trim();
        if (term.length > 2 && term.length < 80 && !seenTerms.has(term.toLowerCase()) && !line.includes(`**${term}**`)) {
          seenTerms.add(term.toLowerCase());
          entities.push({
            name: term,
            type: 'term',
            location: { sourceId, scopeId: this.findSection(i, sections), startLine: i },
          });
        }
      }
      italicPattern.lastIndex = 0;
    }

    // 3. Defined terms — "X is defined as", "X refers to", "X means"
    const defPatterns = [
      /[""]?([A-Z][A-Za-z\s-]{2,40})[""]?\s+(?:is defined as|refers to|means|is|are)\s/g,
      /(?:define|defines|defined)\s+[""]?([A-Z][A-Za-z\s-]{2,40})[""]?\s+as/gi,
    ];

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of defPatterns) {
        let m;
        while ((m = pattern.exec(lines[i])) !== null) {
          const term = m[1].trim();
          if (term.length > 2 && !seenTerms.has(term.toLowerCase())) {
            seenTerms.add(term.toLowerCase());
            entities.push({
              name: term,
              type: 'concept',
              description: `Defined in text`,
              location: { sourceId, scopeId: this.findSection(i, sections), startLine: i },
            });
          }
        }
        pattern.lastIndex = 0;
      }
    }

    // 4. Citations — (Author, Year) or [N] patterns
    const citationPattern1 = /\(([A-Z][a-z]+(?:\s+(?:et\s+al\.?|and|&)\s+[A-Z][a-z]+)?,\s*\d{4})\)/g;
    const citationPattern2 = /\[(\d{1,3})\]/g;

    for (let i = 0; i < lines.length; i++) {
      let m;
      while ((m = citationPattern1.exec(lines[i])) !== null) {
        const cite = m[1].trim();
        if (!seenTerms.has(cite.toLowerCase())) {
          seenTerms.add(cite.toLowerCase());
          entities.push({
            name: cite,
            type: 'citation',
            location: { sourceId, scopeId: this.findSection(i, sections), startLine: i },
          });
        }
      }
      citationPattern1.lastIndex = 0;
    }

    // 5. Named entities — capitalised multi-word phrases, acronyms
    const namedEntityPattern = /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})(?:\s|[.,;:!?]|$)/g;
    const acronymPattern = /\b([A-Z]{2,6})\b/g;

    for (let i = 0; i < lines.length; i++) {
      // Skip headings
      if (lines[i].startsWith('#')) continue;

      let m;
      while ((m = namedEntityPattern.exec(lines[i])) !== null) {
        const name = m[1].trim();
        if (name.length > 3 && !seenTerms.has(name.toLowerCase()) && !this.isCommonPhrase(name)) {
          seenTerms.add(name.toLowerCase());
          entities.push({
            name,
            type: 'entity',
            location: { sourceId, scopeId: this.findSection(i, sections), startLine: i },
          });
        }
      }
      namedEntityPattern.lastIndex = 0;

      while ((m = acronymPattern.exec(lines[i])) !== null) {
        const acr = m[1];
        if (!seenTerms.has(acr.toLowerCase()) && !this.isCommonAcronym(acr)) {
          seenTerms.add(acr.toLowerCase());
          entities.push({
            name: acr,
            type: 'term',
            description: 'Acronym',
            location: { sourceId, scopeId: this.findSection(i, sections), startLine: i },
          });
        }
      }
      acronymPattern.lastIndex = 0;
    }

    // 6. Cross-references — "See Section X", "as discussed in"
    const xrefPattern = /(?:see|as discussed in|as described in|refer to|in)\s+(?:Section|Chapter|Figure|Table)\s+([^\s.,;]+)/gi;
    for (let i = 0; i < lines.length; i++) {
      let m;
      while ((m = xrefPattern.exec(lines[i])) !== null) {
        const target = m[1];
        const currentSection = this.findSection(i, sections);
        // Create relationship from current section concept to referenced section
        const fromEntity = sections.find((s) => s.id === currentSection);
        if (fromEntity) {
          relationships.push({
            sourceName: fromEntity.title,
            targetName: target,
            type: 'references',
            description: `Cross-reference`,
          });
        }
      }
      xrefPattern.lastIndex = 0;
    }

    return { entities, relationships };
  }

  // ─── Code Extraction (from Phase 3 data) ───────────

  extractFromCode(
    symbols: Array<{ name: string; kind: string; filePath: string; startLine: number; endLine: number; calls?: string[]; calledBy?: string[]; imports?: string[] }>,
    sourceId: string,
  ): ExtractionResult {
    const entities: ExtractedEntity[] = [];
    const relationships: ExtractedRelationship[] = [];

    // Map symbol kinds to entity types
    const kindToType: Record<string, string> = {
      function: 'function',
      class: 'class',
      method: 'method',
      interface: 'interface',
      variable: 'variable',
      export: 'export',
    };

    for (const sym of symbols) {
      const entityType = kindToType[sym.kind] || sym.kind;
      entities.push({
        name: sym.name,
        type: entityType,
        properties: { kind: sym.kind, filePath: sym.filePath },
        location: { sourceId, scopeId: sym.filePath, startLine: sym.startLine, endLine: sym.endLine },
      });

      // Call relationships
      for (const callee of (sym.calls || [])) {
        relationships.push({
          sourceName: sym.name,
          targetName: callee,
          type: 'calls',
        });
      }

      // Import relationships
      for (const imp of (sym.imports || [])) {
        relationships.push({
          sourceName: sym.name,
          targetName: imp,
          type: 'imports',
        });
      }
    }

    // Module boundaries — group by file → part_of relationships
    const fileGroups = new Map<string, string[]>();
    for (const sym of symbols) {
      if (!fileGroups.has(sym.filePath)) fileGroups.set(sym.filePath, []);
      fileGroups.get(sym.filePath)!.push(sym.name);
    }

    for (const [filePath, names] of fileGroups) {
      // Create module entity
      const moduleName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || filePath;
      entities.push({
        name: moduleName,
        type: 'module',
        properties: { filePath },
        location: { sourceId, scopeId: filePath },
      });

      for (const name of names) {
        relationships.push({
          sourceName: name,
          targetName: moduleName,
          type: 'part_of',
        });
      }
    }

    return { entities, relationships };
  }

  // ─── Helpers ───────────────────────────────────────

  private findSection(
    lineNum: number,
    sections: Array<{ id: string; startLine: number; endLine: number }>,
  ): string {
    for (const s of sections) {
      if (lineNum >= s.startLine && lineNum <= s.endLine) return s.id;
    }
    return sections[0]?.id || 'root';
  }

  private isCommonPhrase(phrase: string): boolean {
    const common = new Set([
      'the', 'this', 'that', 'these', 'those', 'for example',
      'in order', 'as well', 'such as', 'due to', 'in addition',
      'on the', 'at the', 'to the', 'of the', 'from the',
    ]);
    return common.has(phrase.toLowerCase());
  }

  private isCommonAcronym(acr: string): boolean {
    const common = new Set([
      'THE', 'AND', 'FOR', 'NOT', 'BUT', 'ALL', 'CAN', 'HAS', 'HER',
      'WAS', 'ONE', 'OUR', 'OUT', 'ARE', 'HIS', 'HOW', 'ITS', 'LET',
      'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'DID', 'GET',
      'HIM', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'II', 'III', 'IV',
      'JSON', 'HTTP', 'HTML', 'CSS', 'SQL', 'API', 'URL', 'XML',
      'PDF', 'CSV', 'TXT', 'PNG', 'JPG', 'GIF', 'SVG', 'TODO',
    ]);
    return common.has(acr);
  }
}
