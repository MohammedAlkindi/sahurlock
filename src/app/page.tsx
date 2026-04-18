import Link from 'next/link';

const FEATURES = [
  {
    index: '01',
    title: 'Face tracking',
    description: 'MediaPipe runs in-browser. No server, no uploads — frames are processed in memory.',
  },
  {
    index: '02',
    title: 'Enforcement',
    description: 'Drift past the grace period and a fullscreen alert fires. You cannot click it away.',
  },
  {
    index: '03',
    title: 'Fully local',
    description: 'No account. No backend. Session history lives in your browser only.',
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-2.5">
          <span className="text-sm font-black tracking-tight">
            <span className="text-accent">S</span>ahurLock
          </span>
          <div className="flex items-center gap-0.5">
            <Link href="/session" className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">Session</Link>
            <Link href="/stats"   className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">Stats</Link>
            <Link href="/session" className="ml-1 rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent/90 transition-colors">Start</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="mx-auto flex max-w-lg flex-col items-center px-6 pt-10 pb-4 text-center">

        <h1 className="text-[2.15rem] font-black leading-snug tracking-tight md:text-[2.6rem]">
          Attention tracking{' '}
          <span className="text-accent">with real consequences.</span>
        </h1>

        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Your webcam watches. Look away too long — a fullscreen alert locks you out until you refocus.
        </p>

        <div className="mt-5 flex items-center gap-2.5">
          <Link
            href="/session"
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 transition"
          >
            Start a session
          </Link>
          <Link
            href="/stats"
            className="rounded-lg border border-border px-5 py-2 text-sm font-semibold text-muted-foreground hover:border-foreground/20 hover:text-foreground transition"
          >
            View stats
          </Link>
        </div>

        {/* Terminal preview */}
        <div className="mt-6 w-72 rounded-xl border border-border bg-[#1A1A1A] p-4 text-left font-mono text-xs shadow-lg">
          <div className="mb-3 flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-zinc-700" />
            <span className="h-2 w-2 rounded-full bg-zinc-700" />
            <span className="h-2 w-2 rounded-full bg-zinc-700" />
          </div>
          <p className="text-zinc-500">attention-detector</p>
          <p className="mt-2 text-green-400">face_detected   true</p>
          <p className="text-green-400">confidence      0.94</p>
          <p className="mt-2 text-zinc-500">— 4.2s elapsed —</p>
          <p className="text-red-400">attention       offscreen</p>
          <p className="text-red-400">alert           triggered</p>
        </div>

      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section className="border-t border-border px-6 py-8 mt-4">
        <div className="mx-auto max-w-3xl">
          <div className="grid gap-px overflow-hidden rounded-xl border border-border md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.index}
                className={`bg-card p-5 ${i < FEATURES.length - 1 ? 'border-b border-border md:border-b-0 md:border-r' : ''}`}
              >
                <p className="mb-2.5 font-mono text-[10px] text-muted-foreground/40">{f.index}</p>
                <h3 className="mb-1.5 text-sm font-semibold text-foreground">{f.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border px-6 py-4 text-center text-[10px] text-muted-foreground/40">
        SahurLock &copy; 2026 Mohammed Alkindi &mdash; MIT License
      </footer>

    </main>
  );
}
