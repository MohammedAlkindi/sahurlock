import { describe, expect, it } from 'vitest';
import { say } from './announce';

describe('say', () => {
  it('starts a line when the announcer is empty', () => {
    expect(say(null, 'Saved.', 0, 1)).toEqual({ id: 1, text: 'Saved.' });
  });

  it('gives a message its own line once the last one is on the page', () => {
    expect(say({ id: 1, text: 'Saved.' }, 'Saved.', 1, 2)).toEqual({ id: 2, text: 'Saved.' });
  });

  it('adds a message to a line that has not reached the page yet', () => {
    expect(say({ id: 3, text: 'Opened Lab 2.' }, 'Its regions could not be read.', 2, 4))
      .toEqual({ id: 3, text: 'Opened Lab 2. Its regions could not be read.' });
  });
});
