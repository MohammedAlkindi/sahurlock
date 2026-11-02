import { describe, expect, it } from 'vitest';
import type { Block, BlockKind, Box } from '@/lib/scan/document';
import { buildNotesZip, notesMarkdown } from '@/lib/scan/notes';
import { readZip } from '@/lib/zip-read';

const block = (id: string, kind: BlockKind, box: [number, number, number, number], content: string | null = null): Block => ({
  id, kind, box: { x: box[0], y: box[1], width: box[2], height: box[3] }, content, tokens: [], origin: { by: 'user' }, reviewed: true,
});
const page = (blocks: Block[], regionsComplete = true) => ({ width: 600, height: 800, regionsComplete, blocks });

describe('notesMarkdown', () => {
  it('writes typed regions in reading order and links a picture for the rest', () => {
    const { markdown, crops } = notesMarkdown('Limits', [page([
      block('graph', 'graph', [20, 300, 300, 200]),
      block('def', 'text', [20, 120, 560, 100], 'A limit is the value f approaches.'),
      block('head', 'heading', [20, 20, 560, 60], 'Week 3'),
      block('eq', 'math', [20, 240, 560, 40], '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'),
    ])]);
    expect(markdown).toBe([
      '# Limits',
      '## Week 3',
      'A limit is the value f approaches.',
      '$$\n\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1\n$$',
      // Named as the editor numbers it: the graph was marked first.
      '![Graph on page 1](assets/page-1-region-1.jpg)',
    ].join('\n\n') + '\n');
    expect(crops).toEqual([{ path: 'assets/page-1-region-1.jpg', page: 0, box: { x: 20, y: 300, width: 300, height: 200 } }]);
  });

  it('also keeps a page whole while not every region on it is marked', () => {
    const { markdown, crops } = notesMarkdown('Notes', [page([block('h', 'heading', [0, 0, 100, 40], 'Week 3')], false)]);
    expect(markdown).toBe('# Notes\n\n## Week 3\n\n![Page 1](assets/page-1.jpg)\n');
    expect(crops).toEqual([{ path: 'assets/page-1.jpg', page: 0, box: { x: 0, y: 0, width: 600, height: 800 } }]);
  });

  it('writes LaTeX bare, whatever delimiters it was typed in', () => {
    for (const typed of ['x^2', '$x^2$', '$$x^2$$', '\\[x^2\\]', '\\(x^2\\)']) {
      expect(notesMarkdown('N', [page([block('m', 'math', [0, 0, 10, 10], typed)])]).markdown, typed).toBe('# N\n\n$$\nx^2\n$$\n');
    }
    // Pandoc ends display math at a blank line.
    expect(notesMarkdown('N', [page([block('m', 'math', [0, 0, 10, 10], 'a = b\n\nc = d')])]).markdown).toBe('# N\n\n$$\na = b\nc = d\n$$\n');
  });

  it('keeps a region nothing has read as a picture, so no guess replaces it', () => {
    const { markdown } = notesMarkdown('Notes', [page([block('t', 'text', [0, 0, 100, 50]), block('m', 'math', [0, 60, 100, 50], '  ')])]);
    expect(markdown).toContain('![Text on page 1](assets/page-1-region-1.jpg)');
    expect(markdown).toContain('![Math on page 1](assets/page-1-region-2.jpg)');
  });

  it('puts a page with no regions in whole', () => {
    const { markdown, crops } = notesMarkdown('Notes', [page([]), page([block('h', 'heading', [0, 0, 100, 40], 'Two')])]);
    expect(markdown).toBe('# Notes\n\n![Page 1](assets/page-1.jpg)\n\n## Two\n');
    expect(crops).toEqual([{ path: 'assets/page-1.jpg', page: 0, box: { x: 0, y: 0, width: 600, height: 800 } }]);
  });

  it('escapes typed text so it stays text, and keeps headings on one line', () => {
    const { markdown } = notesMarkdown('Costs $5 *each*', [page([
      block('h', 'heading', [0, 0, 100, 40], 'Part\n[A] #'),
      block('t', 'text', [0, 50, 100, 40], 'x_1 costs $3 <b> `a` \\n'),
    ])]);
    expect(markdown).toBe('# Costs \\$5 \\*each\\*\n\n## Part \\[A\\] \\#\n\nx\\_1 costs \\$3 \\<b> \\`a\\` \\\\n\n');
  });

  it('keeps lines that start like Markdown as typed lines', () => {
    const typed = '# of moles = mass / M\n> 0 means positive\n- only if x > 0\n1. Find the limit\n(a) Show f is continuous\nb) Find f(0)\niv. Last\n  indented\nTotal\n---\na^2 + b~2\ne.g. this';
    const { markdown } = notesMarkdown('N', [page([block('t', 'text', [0, 0, 10, 10], typed)])]);
    expect(markdown).toBe('# N\n\n' + [
      '\\# of moles = mass / M', '\\> 0 means positive', '\\- only if x > 0', '1\\. Find the limit', '(a\\) Show f is continuous',
      'b\\) Find f(0)', 'iv\\. Last', 'indented', 'Total', '\\---', 'a\\^2 + b\\~2', 'e.g. this',
    ].join('\\\n') + '\n');
  });

  it('keeps blank lines as paragraphs', () => {
    expect(notesMarkdown('N', [page([block('t', 'text', [0, 0, 10, 10], 'one\ntwo\n\nthree')])]).markdown).toBe('# N\n\none\\\ntwo\n\nthree\n');
  });
});

describe('buildNotesZip', () => {
  const entries = async (zip: Blob) =>
    readZip(new Uint8Array(await zip.arrayBuffer())).map((f) => ({ name: f.name, data: new TextDecoder().decode(f.data) }));

  it('holds notes.md and each picture, cutting regions from their own page and keeping whole pages as they are', async () => {
    const cuts: Box[] = [];
    const crop = async (jpeg: Blob, box: Box) => { cuts.push(box); return new Blob([`cut ${await jpeg.text()} ${box.x},${box.y}`]); };
    const zip = await buildNotesZip('Notes', [
      { jpeg: new Blob(['page one']), ...page([]) },
      { jpeg: new Blob(['page two']), ...page([block('c', 'graph', [0, 0, 30, 40]), block('g', 'diagram', [10, 50, 30, 40])]) },
    ], crop, new Date(2026, 9, 31));
    expect(await entries(zip)).toEqual([
      { name: 'notes.md', data: '# Notes\n\n![Page 1](assets/page-1.jpg)\n\n![Graph on page 2](assets/page-2-region-1.jpg)\n\n![Diagram on page 2](assets/page-2-region-2.jpg)\n' },
      { name: 'assets/page-1.jpg', data: 'page one' },
      { name: 'assets/page-2-region-1.jpg', data: 'cut page two 0,0' },
      { name: 'assets/page-2-region-2.jpg', data: 'cut page two 10,50' },
    ]);
    expect(cuts).toEqual([{ x: 0, y: 0, width: 30, height: 40 }, { x: 10, y: 50, width: 30, height: 40 }]);
  });
});
