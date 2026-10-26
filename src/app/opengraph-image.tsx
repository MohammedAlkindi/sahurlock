import { ImageResponse } from 'next/og';
import { SITE_IMAGE_ALT, SITE_NAME } from '@/lib/site';

export const alt = SITE_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TOOLS = ['Focus sessions', 'Scan notes', 'Tasks', 'Flashcards', 'Notes', 'Schedule'];

/** The picture shown when a SahurLock link is shared. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 80, background: '#18181b', color: '#fafafa' }}>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>
          <span style={{ color: '#22c55e' }}>S</span>
          <span>{SITE_NAME.slice(1)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3 }}>Study tools that</div>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3, color: '#22c55e' }}>stay on your device.</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {TOOLS.map((tool) => (
            <div key={tool} style={{ display: 'flex', fontSize: 28, padding: '10px 22px', borderRadius: 999, border: '2px solid #3f3f46', color: '#d4d4d8' }}>
              {tool}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
