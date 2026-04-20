import { v4 as uuidv4 } from 'uuid';
import type { RecursiveAnalysisPlan, AnalysisTaskNode } from '../types.js';
import type { DocumentStructure } from '../types.js';

interface SectionInfo {
  id: string;
  title: string;
  depth: number;
  startLine: number;
  endLine: number;
  wordCount: number;
  children: SectionInfo[];
}

export function buildAnalysisPlan(
  sourceId: string,
  structure: DocumentStructure,
  maxLeafTokens: number = 8000,
): RecursiveAnalysisPlan {
  const now = new Date().toISOString();
  const planId = uuidv4();

  // Build section info tree
  const sectionTree = buildSectionTree(structure.sections);

  // Build task tree from section tree
  const taskTree = buildTaskTree(sectionTree, 0, maxLeafTokens);

  // Add root synthesis if there are multiple top-level tasks
  let rootTask: AnalysisTaskNode;
  if (taskTree.length === 1) {
    rootTask = taskTree[0];
  } else {
    rootTask = {
      id: uuidv4(),
      type: 'synthesis',
      scopeId: 'full',
      scopeDescription: 'Full Document Synthesis',
      status: 'pending',
      depth: maxDepth(taskTree) + 1,
      children: taskTree,
      wordCount: taskTree.reduce((s, t) => s + t.wordCount, 0),
      estimatedTokens: taskTree.reduce((s, t) => s + t.estimatedTokens, 0),
    };
  }

  const totalTasks = countTasks(rootTask);

  return {
    id: planId,
    sourceId,
    rootTaskId: rootTask.id,
    totalTasks,
    completedTasks: 0,
    status: 'planned',
    tree: rootTask,
    createdAt: now,
    updatedAt: now,
  };
}

function buildSectionTree(sections: any[]): SectionInfo[] {
  return sections.map((s) => {
    const wc = s.wordCount || estimateWordCount(s.startLine, s.endLine);
    return {
      id: s.id,
      title: s.title,
      depth: s.depth || 0,
      startLine: s.startLine,
      endLine: s.endLine,
      wordCount: wc,
      children: s.children ? buildSectionTree(s.children) : [],
    };
  });
}

function buildTaskTree(
  sections: SectionInfo[],
  currentDepth: number,
  maxLeafTokens: number,
): AnalysisTaskNode[] {
  const tasks: AnalysisTaskNode[] = [];

  for (const section of sections) {
    const estTokens = Math.ceil(section.wordCount * 1.33);

    if (section.children.length === 0) {
      // Leaf section
      if (estTokens <= maxLeafTokens) {
        tasks.push(createLeafTask(section, currentDepth));
      } else {
        // Split into sub-ranges
        const subTasks = splitLargeSection(section, maxLeafTokens, currentDepth);
        if (subTasks.length === 1) {
          tasks.push(subTasks[0]);
        } else {
          tasks.push({
            id: uuidv4(),
            type: 'synthesis',
            scopeId: section.id,
            scopeDescription: section.title,
            status: 'pending',
            depth: currentDepth + 1,
            children: subTasks,
            wordCount: section.wordCount,
            estimatedTokens: estTokens,
          });
        }
      }
    } else {
      // Section with children — recurse
      const childTasks = buildTaskTree(section.children, currentDepth, maxLeafTokens);

      if (childTasks.length === 1) {
        tasks.push(childTasks[0]);
      } else {
        tasks.push({
          id: uuidv4(),
          type: 'synthesis',
          scopeId: section.id,
          scopeDescription: section.title,
          status: 'pending',
          depth: maxDepthOfTasks(childTasks) + 1,
          children: childTasks,
          wordCount: section.wordCount,
          estimatedTokens: estTokens,
        });
      }
    }
  }

  return tasks;
}

function createLeafTask(section: SectionInfo, depth: number): AnalysisTaskNode {
  return {
    id: uuidv4(),
    type: 'leaf',
    scopeId: section.id,
    scopeDescription: section.title,
    status: 'pending',
    depth,
    children: [],
    wordCount: section.wordCount,
    estimatedTokens: Math.ceil(section.wordCount * 1.33),
  };
}

function splitLargeSection(
  section: SectionInfo,
  maxLeafTokens: number,
  depth: number,
): AnalysisTaskNode[] {
  const maxWords = Math.floor(maxLeafTokens / 1.33);
  const totalLines = section.endLine - section.startLine + 1;
  const wordsPerLine = section.wordCount / Math.max(totalLines, 1);
  const linesPerChunk = Math.floor(maxWords / Math.max(wordsPerLine, 1));
  const overlap = 5; // lines overlap

  const tasks: AnalysisTaskNode[] = [];
  let startLine = section.startLine;
  let chunkIndex = 0;

  while (startLine <= section.endLine) {
    const endLine = Math.min(startLine + linesPerChunk - 1, section.endLine);
    const chunkWords = Math.round((endLine - startLine + 1) * wordsPerLine);

    tasks.push({
      id: uuidv4(),
      type: 'leaf',
      scopeId: `${section.id}:${startLine}-${endLine}`,
      scopeDescription: `${section.title} (part ${chunkIndex + 1})`,
      status: 'pending',
      depth,
      children: [],
      wordCount: chunkWords,
      estimatedTokens: Math.ceil(chunkWords * 1.33),
    });

    startLine = endLine + 1 - overlap;
    chunkIndex++;

    if (startLine > section.endLine) break;
  }

  return tasks;
}

function countTasks(node: AnalysisTaskNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countTasks(child);
  }
  return count;
}

function maxDepth(tasks: AnalysisTaskNode[]): number {
  if (tasks.length === 0) return 0;
  return Math.max(...tasks.map((t) => {
    if (t.children.length === 0) return t.depth;
    return Math.max(t.depth, maxDepth(t.children));
  }));
}

function maxDepthOfTasks(tasks: AnalysisTaskNode[]): number {
  if (tasks.length === 0) return 0;
  return Math.max(...tasks.map((t) => t.depth));
}

function estimateWordCount(startLine: number, endLine: number): number {
  return Math.max((endLine - startLine + 1) * 10, 50);
}
