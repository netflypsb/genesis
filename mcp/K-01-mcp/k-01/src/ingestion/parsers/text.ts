import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ParseResult } from '../../types.js';

export function parseTextFile(filePath: string): ParseResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const stats = fs.statSync(filePath);

  let markdown: string;

  if (ext === '.md' || ext === '.mdx') {
    // Markdown files are used as-is
    markdown = content;
  } else if (ext === '.html' || ext === '.htm') {
    markdown = htmlToMarkdown(content);
  } else {
    // Plain text — apply formatting heuristics
    markdown = formatPlainText(content);
  }

  return {
    markdown,
    metadata: {
      fileType: ext.replace('.', ''),
      fileSize: stats.size,
      originalPath: filePath,
    },
  };
}

function formatPlainText(text: string): string {
  const lines = text.split('\n');
  const formatted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect potential headers: ALL CAPS short lines
    if (
      trimmed.length > 0 &&
      trimmed.length < 100 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      !/^\d+$/.test(trimmed)
    ) {
      formatted.push(`## ${trimmed}`);
    }
    // Detect numbered sections like "1. Introduction"
    else if (/^\d+\.\s+\w+/.test(trimmed) && trimmed.length < 120) {
      formatted.push(`### ${trimmed}`);
    }
    // Detect Roman numeral sections
    else if (/^(I{1,3}|IV|V|VI{0,3}|IX|X{0,3})\.\s+\w+/i.test(trimmed) && trimmed.length < 120) {
      formatted.push(`### ${trimmed}`);
    }
    else {
      formatted.push(line);
    }
  }

  return formatted.join('\n');
}

function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style tags
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n');

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Convert bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n');

  // Convert code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n');

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}
