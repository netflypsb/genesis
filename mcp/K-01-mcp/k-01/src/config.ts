import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.k-01');

export interface K01Config {
  baseDir: string;
  documentsDir: string;
  projectsDir: string;
  sessionsDir: string;
  dbPath: string;
  logsDir: string;
  parsers: {
    pdf: {
      preferred: 'mineru' | 'marker' | 'basic' | 'auto';
      mineruPath?: string;
      markerPath?: string;
    };
  };
  embeddings: {
    provider: 'ollama' | 'openai' | 'none';
    model: string;
    apiKey?: string;
    baseUrl?: string;
    dimensions: number;
  };
}

let _config: K01Config | null = null;

export function getConfig(baseDir?: string): K01Config {
  if (_config && !baseDir) return _config;

  const base = baseDir || DEFAULT_BASE_DIR;
  _config = {
    baseDir: base,
    documentsDir: path.join(base, 'documents'),
    projectsDir: path.join(base, 'projects'),
    sessionsDir: path.join(base, 'sessions'),
    dbPath: path.join(base, 'k01.db'),
    logsDir: path.join(base, 'logs'),
    parsers: {
      pdf: {
        preferred: 'auto',
      },
    },
    embeddings: {
      provider: 'none',
      model: '',
      dimensions: 0,
    },
  };

  return _config;
}

export function ensureDirectories(config: K01Config): void {
  const dirs = [
    config.baseDir,
    config.documentsDir,
    config.projectsDir,
    config.sessionsDir,
    config.logsDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Language detection by file extension
const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.h': 'cpp',
  '.c': 'c',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.scala': 'scala',
  '.r': 'r', '.R': 'r',
  '.lua': 'lua',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown', '.mdx': 'markdown',
  '.toml': 'toml',
  '.ini': 'ini',
  '.env': 'env',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.dart': 'dart',
  '.zig': 'zig',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml', '.mli': 'ocaml',
  '.clj': 'clojure', '.cljs': 'clojure',
};

export function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext];
}

// Default patterns to exclude when ingesting projects
export const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.vs',
  'coverage',
  '.nyc_output',
  '.DS_Store',
  'Thumbs.db',
];

// Max file size for individual file ingestion (50MB)
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Max lines to return in a single read_range call
export const MAX_RANGE_LINES = 5000;

// Default context lines for search results
export const DEFAULT_CONTEXT_LINES = 3;

// Max search results
export const MAX_SEARCH_RESULTS = 100;
