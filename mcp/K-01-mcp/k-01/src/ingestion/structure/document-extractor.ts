import type { DocumentStructure, SectionNode, DocumentIndex, SectionIndexEntry } from '../../types.js';

export class DocumentStructureExtractor {

  extract(markdown: string): DocumentStructure {
    const lines = markdown.split('\n');
    const sections: SectionNode[] = [];
    const sectionStack: SectionNode[] = [];
    let currentSection: SectionNode | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headerMatch) {
        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();

        // Close previous section
        if (currentSection) {
          currentSection.endLine = i - 1;
          currentSection.wordCount = this.countWords(
            lines.slice(currentSection.startLine, currentSection.endLine + 1)
          );
        }

        // Create new section
        const newSection: SectionNode = {
          id: this.generateSectionId(level, title, i),
          level,
          title,
          startLine: i,
          endLine: -1,
          children: [],
          wordCount: 0,
        };

        // Find parent — walk stack backward to find a section with lower level
        if (level === 1 || sectionStack.length === 0) {
          sections.push(newSection);
        } else {
          let parent: SectionNode | null = null;
          for (let j = sectionStack.length - 1; j >= 0; j--) {
            if (sectionStack[j].level < level) {
              parent = sectionStack[j];
              break;
            }
          }

          if (parent) {
            newSection.parentId = parent.id;
            parent.children.push(newSection);
          } else {
            sections.push(newSection);
          }
        }

        // Update stack — pop everything at same or deeper level
        while (
          sectionStack.length > 0 &&
          sectionStack[sectionStack.length - 1].level >= level
        ) {
          sectionStack.pop();
        }
        sectionStack.push(newSection);
        currentSection = newSection;
      }
    }

    // Close final section
    if (currentSection) {
      currentSection.endLine = lines.length - 1;
      currentSection.wordCount = this.countWords(
        lines.slice(currentSection.startLine, currentSection.endLine + 1)
      );
    }

    const title = this.extractTitle(markdown, sections);
    const allSections = this.getAllSections(sections);

    return {
      title,
      sections,
      outline: this.generateOutline(sections),
      totalSections: allSections.length,
      maxDepth: this.calculateMaxDepth(sections),
    };
  }

  buildIndex(structure: DocumentStructure): DocumentIndex {
    const sectionsById: Record<string, SectionIndexEntry> = {};
    const sectionsByLevel: Record<number, string[]> = {};
    const lineToSection: Record<number, string> = {};

    const allSections = this.getAllSections(structure.sections);

    for (const section of allSections) {
      sectionsById[section.id] = {
        id: section.id,
        level: section.level,
        title: section.title,
        startLine: section.startLine,
        endLine: section.endLine,
        parentId: section.parentId,
      };

      if (!sectionsByLevel[section.level]) {
        sectionsByLevel[section.level] = [];
      }
      sectionsByLevel[section.level].push(section.id);

      for (let line = section.startLine; line <= section.endLine; line++) {
        lineToSection[line] = section.id;
      }
    }

    return { sectionsById, sectionsByLevel, lineToSection };
  }

  findSectionById(sections: SectionNode[], id: string): SectionNode | null {
    for (const section of sections) {
      if (section.id === id) return section;
      if (section.children.length > 0) {
        const found = this.findSectionById(section.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  getAllSections(sections: SectionNode[]): SectionNode[] {
    const result: SectionNode[] = [];
    for (const section of sections) {
      result.push(section);
      if (section.children.length > 0) {
        result.push(...this.getAllSections(section.children));
      }
    }
    return result;
  }

  private generateSectionId(level: number, title: string, lineNum: number): string {
    const safeTitle = title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30);
    return `${level}-${safeTitle}-${lineNum}`;
  }

  private extractTitle(markdown: string, sections: SectionNode[]): string {
    // Use first H1 if available
    if (sections.length > 0 && sections[0].level === 1) {
      return sections[0].title;
    }
    // Fallback: first non-empty line
    const lines = markdown.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('#')) {
        return trimmed.substring(0, 100);
      }
    }
    return 'Untitled Document';
  }

  private generateOutline(sections: SectionNode[], indent: number = 0): string {
    const lines: string[] = [];
    for (const section of sections) {
      const prefix = '  '.repeat(indent);
      const wordInfo = section.wordCount > 0 ? ` (${section.wordCount} words)` : '';
      lines.push(`${prefix}- ${section.title}${wordInfo} [${section.id}]`);
      if (section.children.length > 0) {
        lines.push(this.generateOutline(section.children, indent + 1));
      }
    }
    return lines.join('\n');
  }

  private calculateMaxDepth(sections: SectionNode[], depth: number = 1): number {
    let max = sections.length > 0 ? depth : 0;
    for (const section of sections) {
      if (section.children.length > 0) {
        const childDepth = this.calculateMaxDepth(section.children, depth + 1);
        if (childDepth > max) max = childDepth;
      }
    }
    return max;
  }

  private countWords(lines: string[]): number {
    return lines.join(' ').split(/\s+/).filter((w) => w.length > 0).length;
  }
}
