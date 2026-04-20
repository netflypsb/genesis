import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ParseResult, ParserConfig } from '../../types.js';

export async function parsePdfFile(filePath: string, parserConfig?: ParserConfig['pdf']): Promise<ParseResult> {
  const stats = fs.statSync(filePath);
  const preferred = parserConfig?.preferred || 'auto';

  let markdown: string | null = null;
  let usedParser = 'none';

  // Phase 3: MinerU → Marker → pdf-parse fallback chain
  if (preferred === 'mineru' || preferred === 'auto') {
    markdown = tryMinerU(filePath, parserConfig?.mineruPath);
    if (markdown) usedParser = 'mineru';
  }

  if (!markdown && (preferred === 'marker' || preferred === 'auto')) {
    markdown = tryMarkerCli(filePath, parserConfig?.markerPath);
    if (markdown) usedParser = 'marker';
  }

  if (!markdown && (preferred === 'basic' || preferred === 'auto')) {
    markdown = await tryPdfParse(filePath);
    if (markdown) usedParser = 'pdf-parse';
  }

  if (!markdown) {
    markdown = `# PDF Import: ${path.basename(filePath)}\n\n> **Note:** No PDF parser is installed. Install MinerU (\`pip install mineru\`) or Marker (\`pip install marker-pdf\`) for high-quality PDF extraction.\n\n_File: ${filePath}_\n_Size: ${stats.size} bytes_\n`;
  }

  return {
    markdown,
    metadata: {
      fileType: 'pdf',
      fileSize: stats.size,
      originalPath: filePath,
    },
  };
}

// Detect which PDF parsers are installed
export function detectPdfParsers(parserConfig?: ParserConfig['pdf']): {
  mineru: boolean;
  marker: boolean;
  pdfParse: boolean;
  active: string;
} {
  const mineru = isMinerUAvailable(parserConfig?.mineruPath);
  const marker = isMarkerAvailable(parserConfig?.markerPath);
  let pdfParse = false;
  try {
    require.resolve('pdf-parse');
    pdfParse = true;
  } catch { /* not installed */ }

  const preferred = parserConfig?.preferred || 'auto';
  let active = 'none';
  if (preferred !== 'auto') {
    active = preferred;
  } else if (mineru) {
    active = 'mineru';
  } else if (marker) {
    active = 'marker';
  } else if (pdfParse) {
    active = 'pdf-parse';
  }

  return { mineru, marker, pdfParse, active };
}

function isMinerUAvailable(customPath?: string): boolean {
  try {
    const cmd = customPath || 'mineru';
    execSync(`${cmd} --help`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isMarkerAvailable(customPath?: string): boolean {
  try {
    const cmd = customPath || 'marker_single';
    execSync(`${cmd} --help`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function tryMinerU(filePath: string, customPath?: string): string | null {
  try {
    const tmpDir = path.join(path.dirname(filePath), '.k01-mineru-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const cmd = customPath || 'mineru';
      execSync(`${cmd} -p "${filePath}" -o "${tmpDir}" -m auto`, {
        timeout: 600_000, // 10 minute timeout
        stdio: 'pipe',
      });

      const outputFiles = findMarkdownFiles(tmpDir);
      if (outputFiles.length > 0) {
        return fs.readFileSync(outputFiles[0], 'utf-8');
      }
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  } catch {
    // MinerU not installed or failed
  }
  return null;
}

function tryMarkerCli(filePath: string, customPath?: string): string | null {
  try {
    // Create a temp output directory
    const tmpDir = path.join(path.dirname(filePath), '.k01-marker-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const cmd = customPath || 'marker_single';
      execSync(`${cmd} "${filePath}" "${tmpDir}"`, {
        timeout: 300_000, // 5 minute timeout for large PDFs
        stdio: 'pipe',
      });

      // Marker outputs a directory with the markdown file inside
      const outputFiles = findMarkdownFiles(tmpDir);
      if (outputFiles.length > 0) {
        const markdown = fs.readFileSync(outputFiles[0], 'utf-8');
        return markdown;
      }
    } finally {
      // Clean up temp directory
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  } catch {
    // Marker not installed or failed — fall through
  }
  return null;
}

async function tryPdfParse(filePath: string): Promise<string | null> {
  try {
    // Dynamic import to handle pdf-parse not being installed
    // @ts-ignore — pdf-parse is an optional dependency
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);

    // Format raw text with basic heuristics
    const text = data.text || '';
    return formatPdfText(text, data.info?.Title, data.numpages);
  } catch {
    // pdf-parse not installed or failed
    return null;
  }
}

function formatPdfText(text: string, title?: string, pages?: number): string {
  const lines = text.split('\n');
  const formatted: string[] = [];

  if (title) {
    formatted.push(`# ${title}\n`);
  }
  if (pages) {
    formatted.push(`_${pages} pages_\n`);
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect potential headers
    if (
      trimmed.length > 0 &&
      trimmed.length < 100 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      !/^\d+$/.test(trimmed)
    ) {
      formatted.push(`\n## ${trimmed}\n`);
    } else if (/^\d+\.\s+\w+/.test(trimmed) && trimmed.length < 120) {
      formatted.push(`\n### ${trimmed}\n`);
    } else {
      formatted.push(line);
    }
  }

  return formatted.join('\n');
}

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors
  }
  return results;
}
