import * as fs from 'node:fs';
import type { ParseResult } from '../../types.js';

export function parseCodeFile(filePath: string): ParseResult {
  const stats = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');

  return {
    markdown: content,
    metadata: {
      fileType: 'code',
      fileSize: stats.size,
      originalPath: filePath,
    },
  };
}
