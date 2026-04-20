import type { K01Config } from '../config.js';
import type { EmbeddingConfig } from '../types.js';

export class EmbeddingProvider {
  private config: K01Config;

  constructor(config: K01Config) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.embeddings.provider !== 'none' && this.config.embeddings.model !== '';
  }

  getProviderName(): string {
    return this.config.embeddings.provider;
  }

  configure(provider: 'ollama' | 'openai', model: string, apiKey?: string, baseUrl?: string): void {
    this.config.embeddings.provider = provider;
    this.config.embeddings.model = model;

    if (provider === 'ollama') {
      this.config.embeddings.baseUrl = baseUrl || 'http://localhost:11434';
      this.config.embeddings.dimensions = 0; // auto-detect on first call
    } else if (provider === 'openai') {
      this.config.embeddings.apiKey = apiKey;
      this.config.embeddings.baseUrl = baseUrl || 'https://api.openai.com/v1';
      // Common dimensions
      if (model.includes('3-small')) this.config.embeddings.dimensions = 1536;
      else if (model.includes('3-large')) this.config.embeddings.dimensions = 3072;
      else this.config.embeddings.dimensions = 1536;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.isConfigured()) {
      throw new Error('Embedding provider not configured. Use k01_configure_embeddings first.');
    }

    switch (this.config.embeddings.provider) {
      case 'ollama':
        return this.embedViaOllama(texts);
      case 'openai':
        return this.embedViaOpenAI(texts);
      default:
        throw new Error(`Unknown embedding provider: ${this.config.embeddings.provider}`);
    }
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    return results[0];
  }

  private async embedViaOllama(texts: string[]): Promise<Float32Array[]> {
    const baseUrl = this.config.embeddings.baseUrl || 'http://localhost:11434';
    const model = this.config.embeddings.model;
    const results: Float32Array[] = [];

    // Ollama embeds one at a time
    for (const text of texts) {
      const response = await fetch(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Ollama embedding failed: ${response.status} ${err}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      const embedding = new Float32Array(data.embeddings[0]);

      // Auto-detect dimensions on first call
      if (this.config.embeddings.dimensions === 0) {
        this.config.embeddings.dimensions = embedding.length;
      }

      results.push(embedding);
    }

    return results;
  }

  private async embedViaOpenAI(texts: string[]): Promise<Float32Array[]> {
    const baseUrl = this.config.embeddings.baseUrl || 'https://api.openai.com/v1';
    const apiKey = this.config.embeddings.apiKey;
    const model = this.config.embeddings.model;

    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Pass apiKey when configuring embeddings.');
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.status} ${err}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }
}

// Chunk text for embedding (split long text into overlapping chunks)
export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50,
): { text: string; startChar: number }[] {
  const chunks: { text: string; startChar: number }[] = [];
  const words = text.split(/\s+/);

  let wordIndex = 0;
  let charIndex = 0;

  while (wordIndex < words.length) {
    const chunkWords: string[] = [];
    let chunkLength = 0;
    const startChar = charIndex;
    const startWordIndex = wordIndex;

    // Build chunk up to chunkSize words
    while (wordIndex < words.length && chunkLength < chunkSize) {
      chunkWords.push(words[wordIndex]);
      chunkLength++;
      charIndex += words[wordIndex].length + 1;
      wordIndex++;
    }

    if (chunkWords.length > 0) {
      chunks.push({
        text: chunkWords.join(' '),
        startChar,
      });
    }

    // Overlap: move back
    if (wordIndex < words.length) {
      const overlapWords = Math.min(overlap, chunkWords.length);
      wordIndex -= overlapWords;
      charIndex -= chunkWords.slice(-overlapWords).reduce((s, w) => s + w.length + 1, 0);
    }
  }

  return chunks;
}
