import * as path from 'node:path';
import * as fs from 'node:fs';
import type { K01Config } from '../config.js';
import { getGrammarWasmPath, listAvailableGrammars } from './language-registry.js';

// Type for web-tree-sitter - dynamically imported
type TreeSitterModule = any;
type Parser = any;
type Language = any;
type Tree = any;

let _Parser: any = null;
let _initialized = false;
const _languageCache: Map<string, Language> = new Map();

export class TreeSitterParser {
  private config: K01Config;
  private grammarsDir: string;

  constructor(config: K01Config) {
    this.config = config;
    this.grammarsDir = path.join(config.baseDir, 'grammars');
    fs.mkdirSync(this.grammarsDir, { recursive: true });
  }

  async init(): Promise<boolean> {
    if (_initialized) return true;

    try {
      const TreeSitter = await import('web-tree-sitter');
      _Parser = TreeSitter.default || TreeSitter;
      await _Parser.init();
      _initialized = true;
      return true;
    } catch {
      console.error('web-tree-sitter not available — falling back to regex extraction');
      return false;
    }
  }

  isAvailable(): boolean {
    return _initialized;
  }

  getAvailableLanguages(): string[] {
    return listAvailableGrammars(this.grammarsDir);
  }

  getGrammarsDir(): string {
    return this.grammarsDir;
  }

  async parse(content: string, language: string): Promise<Tree | null> {
    if (!_initialized || !_Parser) return null;

    const lang = await this.loadLanguage(language);
    if (!lang) return null;

    const parser = new _Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    return tree;
  }

  private async loadLanguage(language: string): Promise<Language | null> {
    if (_languageCache.has(language)) {
      return _languageCache.get(language)!;
    }

    const wasmPath = getGrammarWasmPath(language, this.grammarsDir);
    if (!wasmPath) return null;

    try {
      const lang = await _Parser.Language.load(wasmPath);
      _languageCache.set(language, lang);
      return lang;
    } catch {
      return null;
    }
  }
}
