import type {
  CitationSource,
  ConfidenceTier,
  GroundedAnswerContext,
  SearchResult,
} from '@/lib/types';

/**
 * Extract a concise excerpt around the matched keywords, or beginning of chunk.
 */
export function extractExcerpt(text: string, maxLength = 240): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const slice = cleaned.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const truncated = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${truncated}...`;
}

/**
 * Calibrate confidence tier from search results.
 * Folio rates confidence in 4 tiers:
 * - 'high': multiple strong matches or a standout high-scoring passage.
 * - 'medium': moderate match scores with reasonable coverage.
 * - 'low': weak or distant matches.
 * - 'insufficient_data': no matches or all matches below relevance floor.
 */
export function evaluateConfidence(results: SearchResult[]): ConfidenceTier {
  if (!results || results.length === 0) {
    return 'insufficient_data';
  }

  const topResult = results[0];
  // distance conventions: 0 is best match, 1 is no match
  if (topResult.distance > 0.85 && topResult.score < 0.1) {
    return 'insufficient_data';
  }

  if (topResult.distance < 0.25 || (results.length >= 2 && topResult.distance < 0.45)) {
    return 'high';
  }

  if (topResult.distance < 0.65) {
    return 'medium';
  }

  return 'low';
}

/**
 * Format a single inline citation string (e.g. "Source: Lecture 4 Notes, p. 3").
 */
export function formatInlineCitation(source: Pick<CitationSource, 'title' | 'pageNumber'>): string {
  if (source.pageNumber !== null && source.pageNumber !== undefined) {
    return `Source: ${source.title}, p. ${source.pageNumber}`;
  }
  return `Source: ${source.title}`;
}

/**
 * Build structured citation sources from search results.
 */
export function buildCitationSources(
  results: SearchResult[],
  maxSources = 5,
): CitationSource[] {
  const confidence = evaluateConfidence(results);

  return results.slice(0, maxSources).map((r) => ({
    documentId: r.chunk.documentId,
    title: r.chunk.title,
    course: r.chunk.course,
    pageNumber: r.chunk.pageNumber,
    chunkIndex: r.chunk.chunkIndex,
    excerpt: extractExcerpt(r.chunk.text),
    confidence,
  }));
}

/**
 * Format search results into a grounded context block with citations and confidence tier.
 */
export function buildGroundedContext(
  results: SearchResult[],
  maxSources = 5,
): GroundedAnswerContext {
  const sources = buildCitationSources(results, maxSources);
  const confidence = evaluateConfidence(results);

  if (sources.length === 0) {
    return {
      promptContext: 'No relevant passages found in your notes.',
      sources: [],
      confidence: 'insufficient_data',
    };
  }

  const blocks: string[] = [];
  sources.forEach((s, idx) => {
    const pageRef = s.pageNumber ? ` (p. ${s.pageNumber})` : '';
    const courseRef = s.course ? ` [${s.course}]` : '';
    blocks.push(`--- [${idx + 1}] ${s.title}${courseRef}${pageRef} ---\n${s.excerpt}`);
  });

  const promptContext = blocks.join('\n\n');

  return {
    promptContext,
    sources,
    confidence,
  };
}
