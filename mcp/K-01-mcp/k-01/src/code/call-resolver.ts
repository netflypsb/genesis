import type { CallGraphEdge, EnhancedSymbolNode } from '../types.js';

type SyntaxNode = any;

export class CallResolver {

  extractCalls(tree: any, filePath: string, language: string): CallGraphEdge[] {
    const edges: CallGraphEdge[] = [];
    this.walk(tree.rootNode, (node: SyntaxNode) => {
      if (node.type === 'call_expression' || node.type === 'new_expression') {
        const callee = this.resolveCalleeName(node, language);
        if (callee) {
          edges.push({
            from: this.findEnclosingFunction(node) || '<module>',
            to: callee,
            filePath,
            line: node.startPosition.row,
          });
        }
      }
    });
    return edges;
  }

  buildCallGraph(
    symbols: EnhancedSymbolNode[],
    edges: CallGraphEdge[],
  ): void {
    const symbolMap = new Map<string, EnhancedSymbolNode>();
    for (const sym of symbols) {
      symbolMap.set(sym.name, sym);
      symbolMap.set(`${sym.filePath}:${sym.name}`, sym);
    }

    for (const edge of edges) {
      // Set caller's outgoing calls
      const caller = symbolMap.get(edge.from) || symbolMap.get(`${edge.filePath}:${edge.from}`);
      if (caller && !caller.calls.includes(edge.to)) {
        caller.calls.push(edge.to);
      }

      // Set callee's incoming callers
      const callee = symbolMap.get(edge.to) || symbolMap.get(`${edge.filePath}:${edge.to}`);
      if (callee && !callee.calledBy.includes(edge.from)) {
        callee.calledBy.push(edge.from);
      }
    }
  }

  getCallersOf(symbolName: string, symbols: EnhancedSymbolNode[], depth: number = 1): EnhancedSymbolNode[] {
    const result: EnhancedSymbolNode[] = [];
    const visited = new Set<string>();
    this.collectCallers(symbolName, symbols, depth, visited, result);
    return result;
  }

  getCalleesOf(symbolName: string, symbols: EnhancedSymbolNode[], depth: number = 1): EnhancedSymbolNode[] {
    const result: EnhancedSymbolNode[] = [];
    const visited = new Set<string>();
    this.collectCallees(symbolName, symbols, depth, visited, result);
    return result;
  }

  private collectCallers(
    name: string,
    symbols: EnhancedSymbolNode[],
    depth: number,
    visited: Set<string>,
    result: EnhancedSymbolNode[],
  ): void {
    if (depth <= 0 || visited.has(name)) return;
    visited.add(name);

    const sym = symbols.find((s) => s.name === name);
    if (!sym) return;

    for (const callerName of sym.calledBy) {
      const caller = symbols.find((s) => s.name === callerName);
      if (caller && !result.includes(caller)) {
        result.push(caller);
        this.collectCallers(callerName, symbols, depth - 1, visited, result);
      }
    }
  }

  private collectCallees(
    name: string,
    symbols: EnhancedSymbolNode[],
    depth: number,
    visited: Set<string>,
    result: EnhancedSymbolNode[],
  ): void {
    if (depth <= 0 || visited.has(name)) return;
    visited.add(name);

    const sym = symbols.find((s) => s.name === name);
    if (!sym) return;

    for (const calleeName of sym.calls) {
      const callee = symbols.find((s) => s.name === calleeName);
      if (callee && !result.includes(callee)) {
        result.push(callee);
        this.collectCallees(calleeName, symbols, depth - 1, visited, result);
      }
    }
  }

  private resolveCalleeName(node: SyntaxNode, language: string): string | null {
    const funcNode = node.childForFieldName('function') || node.childForFieldName('constructor') || node.namedChildren?.[0];
    if (!funcNode) return null;

    // member_expression: obj.method()
    if (funcNode.type === 'member_expression' || funcNode.type === 'attribute') {
      const prop = funcNode.childForFieldName('property') || funcNode.childForFieldName('attribute');
      return prop?.text || null;
    }

    // Simple identifier: func()
    if (funcNode.type === 'identifier' || funcNode.type === 'property_identifier') {
      return funcNode.text;
    }

    return null;
  }

  private findEnclosingFunction(node: SyntaxNode): string | null {
    let current = node.parent;
    while (current) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'function_definition' ||
        current.type === 'method_definition' ||
        current.type === 'method_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function_item'
      ) {
        const name = current.childForFieldName('name');
        return name?.text || null;
      }
      current = current.parent;
    }
    return null;
  }

  private walk(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.namedChildren || []) {
      this.walk(child, callback);
    }
  }
}
