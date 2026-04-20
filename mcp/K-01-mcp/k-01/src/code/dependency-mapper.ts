import type { DependencyEdge } from '../types.js';

type SyntaxNode = any;

export class DependencyMapper {

  extractDependencies(tree: any, filePath: string, language: string): DependencyEdge[] {
    const edges: DependencyEdge[] = [];

    this.walk(tree.rootNode, (node: SyntaxNode) => {
      switch (language) {
        case 'javascript':
        case 'typescript':
        case 'tsx':
          this.extractJsTsImport(node, filePath, edges);
          break;
        case 'python':
          this.extractPythonImport(node, filePath, edges);
          break;
        case 'go':
          this.extractGoImport(node, filePath, edges);
          break;
        case 'rust':
          this.extractRustUse(node, filePath, edges);
          break;
        case 'java':
        case 'csharp':
          this.extractJavaImport(node, filePath, edges);
          break;
      }
    });

    return edges;
  }

  getImportsOf(filePath: string, allEdges: DependencyEdge[]): DependencyEdge[] {
    return allEdges.filter((e) => e.fromFile === filePath);
  }

  getImportersOf(modulePath: string, allEdges: DependencyEdge[]): DependencyEdge[] {
    return allEdges.filter((e) => e.toModule === modulePath || e.toModule.endsWith('/' + modulePath));
  }

  private extractJsTsImport(node: SyntaxNode, filePath: string, edges: DependencyEdge[]): void {
    // import { x, y } from 'module'
    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source');
      if (source) {
        const module = source.text.replace(/['"]/g, '');
        const isRelative = module.startsWith('.') || module.startsWith('/');
        const importNames: string[] = [];

        // Named imports
        for (const child of node.namedChildren || []) {
          if (child.type === 'import_clause') {
            for (const spec of child.namedChildren || []) {
              if (spec.type === 'import_specifier') {
                const name = spec.childForFieldName('name');
                if (name) importNames.push(name.text);
              } else if (spec.type === 'identifier') {
                importNames.push(spec.text); // default import
              } else if (spec.type === 'namespace_import') {
                importNames.push('*');
              }
            }
          }
        }

        edges.push({ fromFile: filePath, toModule: module, importNames, isRelative });
      }
    }

    // const x = require('module')
    if (node.type === 'call_expression') {
      const func = node.childForFieldName('function');
      if (func?.text === 'require') {
        const args = node.childForFieldName('arguments');
        const firstArg = args?.namedChildren?.[0];
        if (firstArg?.type === 'string') {
          const module = firstArg.text.replace(/['"]/g, '');
          const isRelative = module.startsWith('.') || module.startsWith('/');
          edges.push({ fromFile: filePath, toModule: module, importNames: ['*'], isRelative });
        }
      }
    }
  }

  private extractPythonImport(node: SyntaxNode, filePath: string, edges: DependencyEdge[]): void {
    // import module
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren || []) {
        if (child.type === 'dotted_name') {
          edges.push({
            fromFile: filePath,
            toModule: child.text,
            importNames: ['*'],
            isRelative: false,
          });
        }
      }
    }

    // from module import x, y
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name');
      const module = moduleNode?.text || '';
      const isRelative = module.startsWith('.');
      const importNames: string[] = [];

      for (const child of node.namedChildren || []) {
        if (child.type === 'dotted_name' && child !== moduleNode) {
          importNames.push(child.text);
        } else if (child.type === 'import_list') {
          for (const spec of child.namedChildren || []) {
            if (spec.type === 'dotted_name' || spec.type === 'identifier') {
              importNames.push(spec.text);
            }
          }
        }
      }

      edges.push({ fromFile: filePath, toModule: module, importNames, isRelative });
    }
  }

  private extractGoImport(node: SyntaxNode, filePath: string, edges: DependencyEdge[]): void {
    if (node.type === 'import_declaration') {
      for (const child of node.namedChildren || []) {
        if (child.type === 'import_spec') {
          const pathNode = child.childForFieldName('path');
          if (pathNode) {
            const module = pathNode.text.replace(/"/g, '');
            edges.push({
              fromFile: filePath,
              toModule: module,
              importNames: ['*'],
              isRelative: !module.includes('.'),
            });
          }
        } else if (child.type === 'import_spec_list') {
          for (const spec of child.namedChildren || []) {
            const pathNode = spec.childForFieldName('path');
            if (pathNode) {
              const module = pathNode.text.replace(/"/g, '');
              edges.push({
                fromFile: filePath,
                toModule: module,
                importNames: ['*'],
                isRelative: !module.includes('.'),
              });
            }
          }
        }
      }
    }
  }

  private extractRustUse(node: SyntaxNode, filePath: string, edges: DependencyEdge[]): void {
    if (node.type === 'use_declaration') {
      const path = node.namedChildren?.[0];
      if (path) {
        const module = path.text.replace(/::/g, '/');
        const isRelative = module.startsWith('self') || module.startsWith('super') || module.startsWith('crate');
        edges.push({
          fromFile: filePath,
          toModule: module,
          importNames: ['*'],
          isRelative,
        });
      }
    }
  }

  private extractJavaImport(node: SyntaxNode, filePath: string, edges: DependencyEdge[]): void {
    if (node.type === 'import_declaration') {
      const path = node.namedChildren?.[0];
      if (path) {
        edges.push({
          fromFile: filePath,
          toModule: path.text,
          importNames: ['*'],
          isRelative: false,
        });
      }
    }

    // C# using
    if (node.type === 'using_directive') {
      const name = node.namedChildren?.[0];
      if (name) {
        edges.push({
          fromFile: filePath,
          toModule: name.text,
          importNames: ['*'],
          isRelative: false,
        });
      }
    }
  }

  private walk(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.namedChildren || []) {
      this.walk(child, callback);
    }
  }
}
