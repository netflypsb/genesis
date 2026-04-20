import * as path from 'node:path';
import * as fs from 'node:fs';

// Maps K-01 language names to Tree-sitter grammar WASM file names
// Grammar .wasm files must be placed in the grammars/ directory
const GRAMMAR_MAP: Record<string, string> = {
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-tsx',
  python: 'tree-sitter-python',
  rust: 'tree-sitter-rust',
  go: 'tree-sitter-go',
  java: 'tree-sitter-java',
  csharp: 'tree-sitter-c_sharp',
  cpp: 'tree-sitter-cpp',
  c: 'tree-sitter-c',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
};

// Languages that Tree-sitter can parse (grammars available as WASM)
const TREE_SITTER_LANGUAGES = new Set(Object.keys(GRAMMAR_MAP));

export function isTreeSitterLanguage(language: string): boolean {
  return TREE_SITTER_LANGUAGES.has(language);
}

export function getGrammarName(language: string): string | undefined {
  return GRAMMAR_MAP[language];
}

export function getGrammarWasmPath(language: string, grammarsDir: string): string | null {
  const grammarName = GRAMMAR_MAP[language];
  if (!grammarName) return null;

  const wasmPath = path.join(grammarsDir, `${grammarName}.wasm`);
  if (fs.existsSync(wasmPath)) {
    return wasmPath;
  }
  return null;
}

export function listAvailableGrammars(grammarsDir: string): string[] {
  const available: string[] = [];
  for (const [language, grammarName] of Object.entries(GRAMMAR_MAP)) {
    const wasmPath = path.join(grammarsDir, `${grammarName}.wasm`);
    if (fs.existsSync(wasmPath)) {
      available.push(language);
    }
  }
  return available;
}

export function getSupportedLanguages(): string[] {
  return Object.keys(GRAMMAR_MAP);
}
