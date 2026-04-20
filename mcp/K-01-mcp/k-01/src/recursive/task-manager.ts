import { v4 as uuidv4 } from 'uuid';
import type { K01Config } from '../config.js';
import type { RecursiveAnalysisPlan, AnalysisTaskNode } from '../types.js';
import { getDb } from '../store/db.js';
import { AnalysisStore } from '../store/analysis-store.js';

interface PlanRow {
  id: string;
  source_id: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  plan_tree: string;
  created_at: string;
  updated_at: string;
}

export class TaskManager {
  private config: K01Config;
  private analysisStore: AnalysisStore;

  constructor(config: K01Config, analysisStore: AnalysisStore) {
    this.config = config;
    this.analysisStore = analysisStore;
  }

  // ─── Plan CRUD ─────────────────────────────────────

  savePlan(plan: RecursiveAnalysisPlan): void {
    const db = getDb(this.config);
    db.prepare(`
      INSERT OR REPLACE INTO analysis_plans (id, source_id, status, total_tasks, completed_tasks, plan_tree, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(plan.id, plan.sourceId, plan.status, plan.totalTasks, plan.completedTasks, JSON.stringify(plan.tree), plan.createdAt, plan.updatedAt);
  }

  getPlan(planId: string): RecursiveAnalysisPlan | null {
    const db = getDb(this.config);
    const row = db.prepare(`SELECT * FROM analysis_plans WHERE id = ?`).get(planId) as PlanRow | undefined;
    return row ? this.rowToPlan(row) : null;
  }

  getPlansForSource(sourceId: string): RecursiveAnalysisPlan[] {
    const db = getDb(this.config);
    const rows = db.prepare(`SELECT * FROM analysis_plans WHERE source_id = ? ORDER BY created_at DESC`).all(sourceId) as PlanRow[];
    return rows.map((r) => this.rowToPlan(r));
  }

  // ─── Task Execution ────────────────────────────────

  getNextTask(plan: RecursiveAnalysisPlan): AnalysisTaskNode | null {
    // Find the next available task using bottom-up ordering:
    // 1. Find all leaf tasks that are pending
    // 2. If no leaf tasks, find synthesis tasks whose children are all complete
    return this.findNextTask(plan.tree);
  }

  private findNextTask(node: AnalysisTaskNode): AnalysisTaskNode | null {
    // If this is a leaf and pending, it's available
    if (node.type === 'leaf' && node.status === 'pending') {
      return node;
    }

    // If synthesis, check children first (depth-first, bottom-up)
    if (node.type === 'synthesis') {
      // First, try to find pending leaf tasks in children
      for (const child of node.children) {
        const next = this.findNextTask(child);
        if (next) return next;
      }

      // All children handled — if this synthesis is pending and all children complete, it's available
      if (node.status === 'pending' && node.children.every((c) => c.status === 'complete' || c.status === 'skipped')) {
        return node;
      }
    }

    return null;
  }

  completeTask(plan: RecursiveAnalysisPlan, taskId: string, analysis: string, confidence?: number): {
    plan: RecursiveAnalysisPlan;
    nextTask: AnalysisTaskNode | null;
  } {
    const now = new Date().toISOString();

    // Find and update the task in the tree
    const task = this.findTaskById(plan.tree, taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === 'complete') throw new Error(`Task already complete: ${taskId}`);

    // Save analysis to persistent store
    const saved = this.analysisStore.save({
      sourceId: plan.sourceId,
      scopeId: task.scopeId,
      analysisType: task.type === 'leaf' ? 'recursive_leaf' : 'recursive_synthesis',
      content: analysis,
      confidence,
    });

    task.status = 'complete';
    task.analysisId = saved.id;
    task.confidence = confidence;
    task.completedAt = now;

    // Update plan progress
    plan.completedTasks = this.countCompleted(plan.tree);
    plan.status = plan.completedTasks >= plan.totalTasks ? 'complete' : 'in_progress';
    plan.updatedAt = now;

    // Save updated plan
    this.savePlan(plan);

    // Get next task
    const nextTask = this.getNextTask(plan);

    return { plan, nextTask };
  }

  reanalyseTask(plan: RecursiveAnalysisPlan, taskId: string, reason?: string): RecursiveAnalysisPlan {
    const task = this.findTaskById(plan.tree, taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = 'pending';
    task.analysisId = undefined;
    task.confidence = undefined;
    task.completedAt = undefined;
    task.startedAt = undefined;

    plan.completedTasks = this.countCompleted(plan.tree);
    plan.status = 'in_progress';
    plan.updatedAt = new Date().toISOString();

    // Also re-open parent synthesis tasks that depend on this one
    this.reopenParentSynthesisTasks(plan.tree, taskId);

    this.savePlan(plan);
    return plan;
  }

  private reopenParentSynthesisTasks(node: AnalysisTaskNode, childTaskId: string): boolean {
    for (const child of node.children) {
      if (child.id === childTaskId) {
        // This node is the parent — re-open it if it was complete
        if (node.status === 'complete') {
          node.status = 'pending';
          node.analysisId = undefined;
          node.confidence = undefined;
          node.completedAt = undefined;
        }
        return true;
      }
      if (this.reopenParentSynthesisTasks(child, childTaskId)) {
        // Propagate up
        if (node.status === 'complete') {
          node.status = 'pending';
          node.analysisId = undefined;
          node.confidence = undefined;
          node.completedAt = undefined;
        }
        return true;
      }
    }
    return false;
  }

  // ─── Task Content ──────────────────────────────────

  getTaskContent(plan: RecursiveAnalysisPlan, task: AnalysisTaskNode): {
    type: 'leaf_content' | 'synthesis_inputs';
    scopeDescription: string;
    content?: string;
    childAnalyses?: Array<{ taskDescription: string; analysis: string; confidence?: number }>;
  } {
    if (task.type === 'leaf') {
      // The agent will read the content using k01_read_section or k01_read_range
      return {
        type: 'leaf_content',
        scopeDescription: task.scopeDescription,
        content: `Read section "${task.scopeId}" using k01_read_section(sourceId="${plan.sourceId}", sectionId="${task.scopeId}") or k01_read_range for line ranges.`,
      };
    }

    // Synthesis task — gather child analyses
    const childAnalyses: Array<{ taskDescription: string; analysis: string; confidence?: number }> = [];
    for (const child of task.children) {
      if (child.analysisId) {
        const saved = this.analysisStore.getById(child.analysisId);
        if (saved) {
          childAnalyses.push({
            taskDescription: child.scopeDescription,
            analysis: saved.content,
            confidence: child.confidence,
          });
        }
      }
    }

    return {
      type: 'synthesis_inputs',
      scopeDescription: task.scopeDescription,
      childAnalyses,
    };
  }

  // ─── Plan Summary ──────────────────────────────────

  getPlanSummary(plan: RecursiveAnalysisPlan): string {
    const progress = plan.totalTasks > 0 ? ((plan.completedTasks / plan.totalTasks) * 100).toFixed(1) : '0';
    const leafTasks = this.collectTasks(plan.tree, 'leaf');
    const synthTasks = this.collectTasks(plan.tree, 'synthesis');
    const completedLeaves = leafTasks.filter((t) => t.status === 'complete').length;
    const completedSynths = synthTasks.filter((t) => t.status === 'complete').length;

    const lowConfidence = [...leafTasks, ...synthTasks]
      .filter((t) => t.status === 'complete' && (t.confidence ?? 1) < 0.5);

    const parts = [
      `## Analysis Plan: ${plan.sourceId}`,
      `**Status**: ${plan.status} | **Progress**: ${progress}% (${plan.completedTasks}/${plan.totalTasks})`,
      `**Leaf tasks**: ${completedLeaves}/${leafTasks.length} | **Synthesis tasks**: ${completedSynths}/${synthTasks.length}`,
    ];

    if (lowConfidence.length > 0) {
      parts.push(`\n**Low-confidence tasks** (${lowConfidence.length}):`);
      for (const t of lowConfidence) {
        parts.push(`- ${t.scopeDescription} (confidence: ${t.confidence?.toFixed(2)})`);
      }
    }

    const next = this.getNextTask(plan);
    if (next) {
      parts.push(`\n**Next task**: ${next.type} — ${next.scopeDescription} (~${next.wordCount} words)`);
    } else if (plan.status === 'complete') {
      parts.push('\n**Plan complete!** Use k01_get_summary_tree to view the hierarchical summary.');
    }

    return parts.join('\n');
  }

  // ─── Helpers ───────────────────────────────────────

  private findTaskById(node: AnalysisTaskNode, taskId: string): AnalysisTaskNode | null {
    if (node.id === taskId) return node;
    for (const child of node.children) {
      const found = this.findTaskById(child, taskId);
      if (found) return found;
    }
    return null;
  }

  private countCompleted(node: AnalysisTaskNode): number {
    let count = node.status === 'complete' ? 1 : 0;
    for (const child of node.children) {
      count += this.countCompleted(child);
    }
    return count;
  }

  private collectTasks(node: AnalysisTaskNode, type: 'leaf' | 'synthesis'): AnalysisTaskNode[] {
    const result: AnalysisTaskNode[] = [];
    if (node.type === type) result.push(node);
    for (const child of node.children) {
      result.push(...this.collectTasks(child, type));
    }
    return result;
  }

  private rowToPlan(row: PlanRow): RecursiveAnalysisPlan {
    return {
      id: row.id,
      sourceId: row.source_id,
      rootTaskId: JSON.parse(row.plan_tree).id,
      totalTasks: row.total_tasks,
      completedTasks: row.completed_tasks,
      status: row.status as any,
      tree: JSON.parse(row.plan_tree),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
