import { describe, expect, it } from 'vitest';
import { buildNotesIndex, extractNotePages, extractScanPages, searchNotes } from './notes-index';
import { DOCUMENT_VERSION, userBlock } from '@/lib/scan/document';
import type { SavedScan } from '@/lib/scan/library';
import type { Note } from '@/lib/types';

describe('extractNotePages', () => {
  it('extracts note text into single page', () => {
    const note: Note = {
      id: 'n1',
      title: 'Operating Systems',
      body: 'Deadlock requires mutual exclusion, hold and wait, no preemption, and circular wait.',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };
    const pages = extractNotePages(note);
    expect(pages).toHaveLength(1);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[0].text).toContain('Deadlock requires');
  });
});

describe('extractScanPages', () => {
  it('extracts content from marked blocks in reading order', () => {
    const scan: SavedScan = {
      id: 's1',
      title: 'Linear Algebra',
      course: 'MATH204',
      createdAt: '2026-11-01T00:00:00Z',
      pages: [{ jpeg: new Blob(), width: 100, height: 100 }],
      document: {
        version: DOCUMENT_VERSION,
        pages: [
          {
            width: 100,
            height: 100,
            regionsComplete: true,
            blocks: [
              {
                ...userBlock('b1', 'heading', { x: 10, y: 10, width: 80, height: 20 }),
                content: 'Eigenvalues and Eigenvectors',
              },
              {
                ...userBlock('b2', 'text', { x: 10, y: 35, width: 80, height: 40 }),
                content: 'Ax equals lambda x defines the characteristic equation.',
              },
            ],
          },
        ],
      },
    };

    const pages = extractScanPages(scan);
    expect(pages).toHaveLength(1);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[0].text).toContain('Eigenvalues and Eigenvectors');
    expect(pages[0].text).toContain('characteristic equation');
  });
});

describe('buildNotesIndex and searchNotes', () => {
  it('indexes both typed notes and scanned docs and supports course filtering', () => {
    const note: Note = {
      id: 'n1',
      title: 'Data Structures',
      body: 'Red-black trees guarantee logarithmic search, insertion, and deletion times.',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };

    const scan: SavedScan = {
      id: 's1',
      title: 'Discrete Math',
      course: 'CS102',
      createdAt: '2026-11-01T00:00:00Z',
      pages: [{ jpeg: new Blob(), width: 100, height: 100 }],
      document: {
        version: DOCUMENT_VERSION,
        pages: [
          {
            width: 100,
            height: 100,
            regionsComplete: true,
            blocks: [
              {
                ...userBlock('b1', 'text', { x: 0, y: 0, width: 100, height: 100 }),
                content: 'Pigeonhole principle states that if n items are put into m containers with n > m, at least one container must contain more than one item.',
              },
            ],
          },
        ],
      },
    };

    const { index, chunks } = buildNotesIndex({ notes: [note], scans: [scan] });
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Search for note content
    const r1 = searchNotes(index, 'red-black trees logarithmic');
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].chunk.title).toBe('Data Structures');

    // Search for scan content
    const r2 = searchNotes(index, 'pigeonhole containers');
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].chunk.title).toBe('Discrete Math');
    expect(r2[0].chunk.course).toBe('CS102');

    // Filter by course
    const rCourse = searchNotes(index, 'pigeonhole', { course: 'CS102' });
    expect(rCourse.length).toBe(1);

    const rWrongCourse = searchNotes(index, 'pigeonhole', { course: 'MATH999' });
    expect(rWrongCourse).toHaveLength(0);
  });
});
