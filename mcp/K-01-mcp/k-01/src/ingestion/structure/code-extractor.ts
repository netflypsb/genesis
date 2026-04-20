import type { SymbolNode, EnhancedSymbolNode, CallGraphEdge, DependencyEdge } from '../../types.js';
import { TreeSitterParser } from '../../code/parser.js';
import { ASTSymbolExtractor } from '../../code/symbol-extractor.js';
import { CallResolver } from '../../code/call-resolver.js';
import { DependencyMapper } from '../../code/dependency-mapper.js';
import type { K01Config } from '../../config.js';

// Phase 3: Tree-sitter-based extraction with regex fallback
export class CodeSymbolExtractor {
  private treeSitterParser: TreeSitterParser | null = null;
  private astExtractor: ASTSymbolExtractor | null = null;
  private callResolver: CallResolver | null = null;
  private dependencyMapper: DependencyMapper | null = null;
  private treeSitterReady = false;

  async initTreeSitter(config: K01Config): Promise<boolean> {
    try {
      this.treeSitterParser = new TreeSitterParser(config);
      const ok = await this.treeSitterParser.init();
      if (ok) {
        this.astExtractor = new ASTSymbolExtractor();
        this.callResolver = new CallResolver();
        this.dependencyMapper = new DependencyMapper();
        this.treeSitterReady = true;
      }
      return ok;
    } catch {
      this.treeSitterReady = false;
      return false;
    }
  }

  isTreeSitterAvailable(): boolean {
    return this.treeSitterReady;
  }

  getAvailableGrammars(): string[] {
    return this.treeSitterParser?.getAvailableLanguages() || [];
  }

  getGrammarsDir(): string | null {
    return this.treeSitterParser?.getGrammarsDir() || null;
  }

  async extractEnhancedSymbols(content: string, filePath: string, language?: string): Promise<{
    symbols: EnhancedSymbolNode[];
    callEdges: CallGraphEdge[];
    dependencies: DependencyEdge[];
  }> {
    if (!language || !this.treeSitterReady || !this.treeSitterParser || !this.astExtractor) {
      // Fallback: convert basic symbols to enhanced
      const basic = this.extractSymbols(content, filePath, language);
      const enhanced: EnhancedSymbolNode[] = basic.map((s) => ({
        ...s,
        calls: [],
        calledBy: [],
        imports: [],
      }));
      return { symbols: enhanced, callEdges: [], dependencies: [] };
    }

    const tree = await this.treeSitterParser.parse(content, language);
    if (!tree) {
      // Grammar not available — fallback to regex
      const basic = this.extractSymbols(content, filePath, language);
      const enhanced: EnhancedSymbolNode[] = basic.map((s) => ({
        ...s,
        calls: [],
        calledBy: [],
        imports: [],
      }));
      return { symbols: enhanced, callEdges: [], dependencies: [] };
    }

    const symbols = this.astExtractor.extractFromTree(tree, filePath, language);
    const callEdges = this.callResolver!.extractCalls(tree, filePath, language);
    const dependencies = this.dependencyMapper!.extractDependencies(tree, filePath, language);

    // Build call graph on the symbols
    this.callResolver!.buildCallGraph(symbols, callEdges);

    // Populate imports on symbols
    for (const sym of symbols) {
      const fileDeps = dependencies.filter((d) => d.fromFile === filePath);
      sym.imports = fileDeps.map((d) => d.toModule);
    }

    return { symbols, callEdges, dependencies };
  }

  extractSymbols(content: string, filePath: string, language?: string): SymbolNode[] {
    if (!language) return [];

    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.extractJsTsSymbols(content, filePath);
      case 'python':
        return this.extractPythonSymbols(content, filePath);
      case 'go':
        return this.extractGoSymbols(content, filePath);
      case 'rust':
        return this.extractRustSymbols(content, filePath);
      case 'java':
      case 'csharp':
      case 'kotlin':
        return this.extractJavaLikeSymbols(content, filePath);
      default:
        return this.extractGenericSymbols(content, filePath);
    }
  }

  private extractJsTsSymbols(content: string, filePath: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Function declarations: function name(
      const funcMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // Arrow functions: const name = (
      const arrowMatch = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
      if (arrowMatch) {
        symbols.push({
          name: arrowMatch[1],
          kind: 'function',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // Class declarations
      const classMatch = line.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // Interface declarations (TypeScript)
      const ifaceMatch = line.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (ifaceMatch) {
        symbols.push({
          name: ifaceMatch[1],
          kind: 'interface',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // Type declarations (TypeScript)
      const typeMatch = line.match(/^(?:export\s+)?type\s+(\w+)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: 'variable',
          filePath,
          startLine: i,
          endLine: i,
          signature: line.trim(),
        });
        continue;
      }

      // Method definitions inside classes
      const methodMatch = line.match(/^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(methodMatch[1])) {
        symbols.push({
          name: methodMatch[1],
          kind: 'method',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  private extractPythonSymbols(content: string, filePath: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Function definitions
      const funcMatch = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/);
      if (funcMatch) {
        const indent = funcMatch[1].length;
        symbols.push({
          name: funcMatch[2],
          kind: indent > 0 ? 'method' : 'function',
          filePath,
          startLine: i,
          endLine: this.findPythonBlockEnd(lines, i, indent),
          signature: line.trim(),
        });
        continue;
      }

      // Class definitions
      const classMatch = line.match(/^class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          filePath,
          startLine: i,
          endLine: this.findPythonBlockEnd(lines, i, 0),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  private extractGoSymbols(content: string, filePath: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // func name(
      const funcMatch = line.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // type Name struct/interface
      const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: typeMatch[2] === 'interface' ? 'interface' : 'class',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  private extractRustSymbols(content: string, filePath: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // fn name(
      const funcMatch = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // struct/enum/trait
      const structMatch = line.match(/^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/);
      if (structMatch) {
        symbols.push({
          name: structMatch[1],
          kind: 'class',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  private extractJavaLikeSymbols(content: string, filePath: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Class/interface
      const classMatch = line.match(/^\s*(?:public|private|protected)?\s*(?:abstract|static)?\s*(?:class|interface)\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: line.includes('interface') ? 'interface' : 'class',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
        continue;
      }

      // Method
      const methodMatch = line.match(/^\s+(?:public|private|protected)?\s*(?:static)?\s*(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/);
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
        symbols.push({
          name: methodMatch[1],
          kind: 'method',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  private extractGenericSymbols(content: string, filePath: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Generic function pattern
      const funcMatch = line.match(/^\s*(?:(?:pub|public|export|def|func|fn|function|sub|proc)\s+)(\w+)\s*\(/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          filePath,
          startLine: i,
          endLine: this.findBlockEnd(lines, i),
          signature: line.trim(),
        });
      }
    }

    return symbols;
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let started = false;

    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { braceCount++; started = true; }
        if (ch === '}') braceCount--;
      }
      if (started && braceCount <= 0) return i;
    }

    return Math.min(startLine + 50, lines.length - 1);
  }

  private findPythonBlockEnd(lines: string[], startLine: number, baseIndent: number): number {
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= baseIndent) return i - 1;
    }
    return lines.length - 1;
  }
}
