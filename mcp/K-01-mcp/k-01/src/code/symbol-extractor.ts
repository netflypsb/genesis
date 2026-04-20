import type { EnhancedSymbolNode, ParameterNode } from '../types.js';

// Tree-sitter AST → EnhancedSymbolNode extraction
// Each language has different node types for declarations

type SyntaxNode = any;

export class ASTSymbolExtractor {

  extractFromTree(tree: any, filePath: string, language: string): EnhancedSymbolNode[] {
    const root = tree.rootNode;
    const symbols: EnhancedSymbolNode[] = [];

    switch (language) {
      case 'javascript':
      case 'typescript':
      case 'tsx':
        this.extractJsTsSymbols(root, filePath, symbols);
        break;
      case 'python':
        this.extractPythonSymbols(root, filePath, symbols);
        break;
      case 'go':
        this.extractGoSymbols(root, filePath, symbols);
        break;
      case 'rust':
        this.extractRustSymbols(root, filePath, symbols);
        break;
      case 'java':
      case 'csharp':
        this.extractJavaLikeSymbols(root, filePath, symbols);
        break;
      default:
        this.extractGenericSymbols(root, filePath, symbols);
    }

    return symbols;
  }

  private extractJsTsSymbols(root: SyntaxNode, filePath: string, symbols: EnhancedSymbolNode[]): void {
    this.walk(root, (node: SyntaxNode) => {
      // Function declarations
      if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'function', filePath, node, {
            isAsync: this.hasModifier(node, 'async'),
            parameters: this.extractJsParameters(node),
            returnType: this.extractTsReturnType(node),
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      // Arrow functions assigned to variable
      if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
        for (const declarator of this.childrenOfType(node, 'variable_declarator')) {
          const nameNode = declarator.childForFieldName('name');
          const valueNode = declarator.childForFieldName('value');
          if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
            symbols.push(this.buildSymbol(nameNode.text, 'function', filePath, node, {
              isAsync: this.hasModifier(valueNode, 'async'),
              parameters: this.extractJsParameters(valueNode),
              returnType: this.extractTsReturnType(valueNode),
              docstring: this.extractLeadingComment(node),
            }));
          }
        }
      }

      // Class declarations
      if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const classSymbol = this.buildSymbol(nameNode.text, 'class', filePath, node, {
            docstring: this.extractLeadingComment(node),
          });
          symbols.push(classSymbol);

          // Extract methods
          const body = node.childForFieldName('body');
          if (body) {
            for (const member of body.namedChildren) {
              if (member.type === 'method_definition' || member.type === 'public_field_definition') {
                const methodName = member.childForFieldName('name');
                if (methodName) {
                  symbols.push(this.buildSymbol(methodName.text, 'method', filePath, member, {
                    isAsync: this.hasModifier(member, 'async'),
                    isStatic: this.hasModifier(member, 'static'),
                    visibility: this.extractVisibility(member),
                    parameters: this.extractJsParameters(member),
                    returnType: this.extractTsReturnType(member),
                    docstring: this.extractLeadingComment(member),
                  }));
                }
              }
            }
          }
        }
      }

      // Interface declarations (TypeScript)
      if (node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'interface', filePath, node, {
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      // Type alias declarations (TypeScript)
      if (node.type === 'type_alias_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'variable', filePath, node, {
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      // Enum declarations
      if (node.type === 'enum_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'variable', filePath, node, {
            docstring: this.extractLeadingComment(node),
          }));
        }
      }
    });
  }

  private extractPythonSymbols(root: SyntaxNode, filePath: string, symbols: EnhancedSymbolNode[]): void {
    this.walk(root, (node: SyntaxNode) => {
      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const params = this.extractPythonParameters(node);
          const isMethod = node.parent?.type === 'block' &&
            node.parent.parent?.type === 'class_definition';

          symbols.push(this.buildSymbol(nameNode.text, isMethod ? 'method' : 'function', filePath, node, {
            isAsync: node.children[0]?.text === 'async',
            parameters: params,
            returnType: this.extractPythonReturnType(node),
            decorators: this.extractPythonDecorators(node),
            docstring: this.extractPythonDocstring(node),
          }));
        }
      }

      if (node.type === 'class_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'class', filePath, node, {
            decorators: this.extractPythonDecorators(node),
            docstring: this.extractPythonDocstring(node),
          }));
        }
      }
    });
  }

  private extractGoSymbols(root: SyntaxNode, filePath: string, symbols: EnhancedSymbolNode[]): void {
    this.walk(root, (node: SyntaxNode) => {
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'function', filePath, node, {
            parameters: this.extractGoParameters(node),
            returnType: this.extractGoReturnType(node),
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'method', filePath, node, {
            parameters: this.extractGoParameters(node),
            returnType: this.extractGoReturnType(node),
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      if (node.type === 'type_declaration') {
        for (const spec of this.childrenOfType(node, 'type_spec')) {
          const nameNode = spec.childForFieldName('name');
          const typeNode = spec.childForFieldName('type');
          if (nameNode) {
            const kind = typeNode?.type === 'interface_type' ? 'interface' : 'class';
            symbols.push(this.buildSymbol(nameNode.text, kind, filePath, node, {
              docstring: this.extractLeadingComment(node),
            }));
          }
        }
      }
    });
  }

  private extractRustSymbols(root: SyntaxNode, filePath: string, symbols: EnhancedSymbolNode[]): void {
    this.walk(root, (node: SyntaxNode) => {
      if (node.type === 'function_item') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'function', filePath, node, {
            isAsync: node.children.some((c: SyntaxNode) => c.text === 'async'),
            visibility: node.children.some((c: SyntaxNode) => c.type === 'visibility_modifier') ? 'public' : 'private',
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      if (node.type === 'struct_item') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'class', filePath, node, {
            visibility: node.children.some((c: SyntaxNode) => c.type === 'visibility_modifier') ? 'public' : 'private',
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      if (node.type === 'trait_item') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'interface', filePath, node, {
            docstring: this.extractLeadingComment(node),
          }));
        }
      }

      if (node.type === 'enum_item') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'variable', filePath, node, {
            docstring: this.extractLeadingComment(node),
          }));
        }
      }
    });
  }

  private extractJavaLikeSymbols(root: SyntaxNode, filePath: string, symbols: EnhancedSymbolNode[]): void {
    this.walk(root, (node: SyntaxNode) => {
      if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(
            nameNode.text,
            node.type === 'interface_declaration' ? 'interface' : 'class',
            filePath,
            node,
            {
              visibility: this.extractVisibility(node),
              docstring: this.extractLeadingComment(node),
            },
          ));
        }
      }

      if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'method', filePath, node, {
            visibility: this.extractVisibility(node),
            isStatic: this.hasModifier(node, 'static'),
            docstring: this.extractLeadingComment(node),
          }));
        }
      }
    });
  }

  private extractGenericSymbols(root: SyntaxNode, filePath: string, symbols: EnhancedSymbolNode[]): void {
    this.walk(root, (node: SyntaxNode) => {
      if (node.type.includes('function') && node.type.includes('declaration')) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'function', filePath, node, {}));
        }
      }
      if (node.type.includes('class') && node.type.includes('declaration')) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push(this.buildSymbol(nameNode.text, 'class', filePath, node, {}));
        }
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────

  private buildSymbol(
    name: string,
    kind: EnhancedSymbolNode['kind'],
    filePath: string,
    node: SyntaxNode,
    extra: Partial<EnhancedSymbolNode>,
  ): EnhancedSymbolNode {
    return {
      name,
      kind,
      filePath,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: this.extractSignatureLine(node),
      calls: [],
      calledBy: [],
      imports: [],
      ...extra,
    };
  }

  private extractSignatureLine(node: SyntaxNode): string {
    const text = node.text;
    const firstLine = text.split('\n')[0];
    return firstLine.length > 200 ? firstLine.substring(0, 200) + '...' : firstLine;
  }

  private walk(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.namedChildren || []) {
      this.walk(child, callback);
    }
  }

  private childrenOfType(node: SyntaxNode, type: string): SyntaxNode[] {
    return (node.namedChildren || []).filter((c: SyntaxNode) => c.type === type);
  }

  private hasModifier(node: SyntaxNode, modifier: string): boolean {
    for (const child of node.children || []) {
      if (child.text === modifier || child.type === modifier) return true;
    }
    return false;
  }

  private extractVisibility(node: SyntaxNode): 'public' | 'private' | 'protected' | undefined {
    for (const child of node.children || []) {
      if (child.type === 'accessibility_modifier' || child.type === 'visibility_modifier') {
        if (child.text === 'public') return 'public';
        if (child.text === 'private') return 'private';
        if (child.text === 'protected') return 'protected';
      }
    }
    return undefined;
  }

  private extractJsParameters(node: SyntaxNode): ParameterNode[] {
    const params: ParameterNode[] = [];
    const paramsNode = node.childForFieldName('parameters') || node.childForFieldName('formal_parameters');
    if (!paramsNode) return params;

    for (const child of paramsNode.namedChildren || []) {
      if (child.type === 'required_parameter' || child.type === 'optional_parameter' || child.type === 'identifier') {
        const nameNode = child.type === 'identifier' ? child : child.childForFieldName('pattern') || child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        if (nameNode) {
          params.push({
            name: nameNode.text,
            type: typeNode?.text,
          });
        }
      }
    }
    return params;
  }

  private extractTsReturnType(node: SyntaxNode): string | undefined {
    const returnType = node.childForFieldName('return_type');
    return returnType?.text?.replace(/^:\s*/, '');
  }

  private extractPythonParameters(node: SyntaxNode): ParameterNode[] {
    const params: ParameterNode[] = [];
    const paramsNode = node.childForFieldName('parameters');
    if (!paramsNode) return params;

    for (const child of paramsNode.namedChildren || []) {
      if (child.type === 'identifier' || child.type === 'typed_parameter' || child.type === 'default_parameter') {
        const name = child.type === 'identifier' ? child.text : (child.childForFieldName('name')?.text || child.text);
        const type = child.childForFieldName('type')?.text;
        params.push({ name, type });
      }
    }
    return params;
  }

  private extractPythonReturnType(node: SyntaxNode): string | undefined {
    const returnType = node.childForFieldName('return_type');
    return returnType?.text;
  }

  private extractPythonDecorators(node: SyntaxNode): string[] {
    const decorators: string[] = [];
    let prev = node.previousNamedSibling;
    while (prev && prev.type === 'decorator') {
      decorators.unshift(prev.text);
      prev = prev.previousNamedSibling;
    }
    return decorators.length > 0 ? decorators : [];
  }

  private extractPythonDocstring(node: SyntaxNode): string | undefined {
    const body = node.childForFieldName('body');
    if (!body) return undefined;
    const first = body.namedChildren?.[0];
    if (first?.type === 'expression_statement') {
      const str = first.namedChildren?.[0];
      if (str?.type === 'string' || str?.type === 'concatenated_string') {
        return str.text.replace(/^["']{1,3}|["']{1,3}$/g, '').trim();
      }
    }
    return undefined;
  }

  private extractGoParameters(node: SyntaxNode): ParameterNode[] {
    const params: ParameterNode[] = [];
    const paramsNode = node.childForFieldName('parameters');
    if (!paramsNode) return params;

    for (const child of paramsNode.namedChildren || []) {
      if (child.type === 'parameter_declaration') {
        const name = child.childForFieldName('name')?.text || '';
        const type = child.childForFieldName('type')?.text;
        if (name) params.push({ name, type });
      }
    }
    return params;
  }

  private extractGoReturnType(node: SyntaxNode): string | undefined {
    const result = node.childForFieldName('result');
    return result?.text;
  }

  private extractLeadingComment(node: SyntaxNode): string | undefined {
    let prev = node.previousSibling;
    const comments: string[] = [];
    while (prev && (prev.type === 'comment' || prev.type === 'block_comment' || prev.type === 'line_comment')) {
      comments.unshift(prev.text);
      prev = prev.previousSibling;
    }
    return comments.length > 0 ? comments.join('\n') : undefined;
  }
}
