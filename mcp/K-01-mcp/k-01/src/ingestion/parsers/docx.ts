import * as fs from 'node:fs';
import mammoth from 'mammoth';
import type { ParseResult } from '../../types.js';

export async function parseDocxFile(filePath: string): Promise<ParseResult> {
  const stats = fs.statSync(filePath);
  const buffer = fs.readFileSync(filePath);

  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;

  // Convert mammoth HTML to markdown
  const markdown = mammothHtmlToMarkdown(html);

  return {
    markdown,
    metadata: {
      fileType: 'docx',
      fileSize: stats.size,
      originalPath: filePath,
    },
  };
}

function mammothHtmlToMarkdown(html: string): string {
  let md = html;

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

  // Convert bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Convert paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // Convert lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert tables
  md = convertHtmlTable(md);

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // Clean up
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

function convertHtmlTable(html: string): string {
  // Simple table conversion
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableContent: string) => {
    const rows: string[][] = [];
    const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    for (const row of rowMatches) {
      const cells: string[] = [];
      const cellMatches = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];
      for (const cell of cellMatches) {
        const content = cell.replace(/<[^>]+>/g, '').trim();
        cells.push(content);
      }
      rows.push(cells);
    }

    if (rows.length === 0) return '';

    let md = '\n';
    // Header row
    md += '| ' + rows[0].join(' | ') + ' |\n';
    md += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
    // Data rows
    for (let i = 1; i < rows.length; i++) {
      md += '| ' + rows[i].join(' | ') + ' |\n';
    }
    md += '\n';

    return md;
  });
}
