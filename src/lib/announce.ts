/** The one line an announcer holds. Each new line has a new id, so it is a new node and the same words twice are read twice. */
export interface Spoken {
  id: number;
  text: string;
}

/**
 * The announcer's line once `text` is said. A line that has not reached the
 * page yet (its id is above `shown`, the id on the page) takes the new text on
 * the end, so two messages made in one update are both read. Otherwise the new
 * text gets a line of its own, numbered `id`.
 */
export function say(line: Spoken | null, text: string, shown: number, id: number): Spoken {
  return line && line.id > shown ? { id: line.id, text: `${line.text} ${text}` } : { id, text };
}
