import Link from 'next/link';

const FEATURES = [
  { index: '01', title: 'Face tracking',  description: 'MediaPipe runs in-browser. No server, no uploads.' },
  { index: '02', title: 'Enforcement',    description: 'A fullscreen alert fires on violation. You cannot click it away.' },
  { index: '03', title: 'Fully local',    description: 'No account. No backend. History stays in your browser.' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background">

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <span className="text-base font-black tracking-tight">
            <span className="text-accent">S</span>ahurLock
          </span>
          <div className="flex items-center gap-1">
            <Link href="/session" className="rounded-md px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              Session
            </Link>
            <Link href="/stats" className="rounded-md px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              Stats
            </Link>
            <Link href="/session" className="ml-2 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 transition-colors">
              Start
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-16 pb-10 text-center">
        <h1 className="text-6xl font-black leading-[1.05] tracking-tight md:text-7xl lg:text-8xl">
          Attention tracking<br />
          <span className="text-accent">with real consequences.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
          Your webcam watches. Look away too long — a fullscreen alert locks you out until you refocus.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/session"
            className="rounded-xl bg-accent px-8 py-3.5 text-base font-semibold text-accent-foreground hover:bg-accent/90 transition shadow-sm"
          >
            Start a session
          </Link>
          <Link
            href="/stats"
            className="rounded-xl border border-border px-8 py-3.5 text-base font-semibold text-muted-foreground hover:border-foreground/20 hover:text-foreground transition"
          >
            View stats
          </Link>
        </div>

        {/* Terminal */}
        <div className="mx-auto mt-10 w-full max-w-lg rounded-2xl border border-border bg-[#111111] p-7 text-left font-mono text-[13px] leading-relaxed shadow-xl ring-1 ring-black/5">
          <div className="mb-5 flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-zinc-700" />
            <span className="h-3 w-3 rounded-full bg-zinc-700" />
            <span className="h-3 w-3 rounded-full bg-zinc-700" />
          </div>
          <p className="text-zinc-600">attention-detector v1</p>
          <p className="mt-3 text-green-400">face_detected   <span className="text-green-300">true</span></p>
          <p className="text-green-400">confidence      <span className="text-green-300">0.94</span></p>
          <p className="mt-3 text-zinc-600">— 4.2s elapsed —</p>
          <p className="text-red-400">attention       <span className="text-red-300">offscreen</span></p>
          <p className="text-red-400">alert           <span className="text-red-300">triggered</span></p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-4">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.index}
              className={`bg-card p-8 ${i < FEATURES.length - 1 ? 'border-b border-border md:border-b-0 md:border-r' : ''}`}
            >
              <p className="mb-3 font-mono text-[11px] text-muted-foreground/40">{f.index}</p>
              <h3 className="mb-2 text-base font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground/40">
        SahurLock &copy; 2026 Mohammed Alkindi &mdash; MIT License
      </footer>

    </main>
  );
}
