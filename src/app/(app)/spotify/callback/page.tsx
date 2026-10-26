'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SpotifyService } from '@/lib/spotify';

type Status = 'loading' | 'success' | 'error';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:         'You cancelled the Spotify login.',
  state_mismatch:        'Security check failed. Please try connecting again.',
  token_exchange_failed: 'Could not connect to Spotify. Please try again.',
  server_misconfigured:  'Spotify is not configured on this server.',
  unknown:               'Something went wrong. Please try again.',
};

function CallbackInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [status,      setStatus]      = useState<Status>('loading');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [errorMsg,    setErrorMsg]    = useState('');
  const [countdown,   setCountdown]   = useState(3);

  useEffect(() => {
    const errorCode = searchParams.get('error');
    if (errorCode) {
      setErrorMsg(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.unknown);
      setStatus('error');
      return;
    }

    const service = SpotifyService.getInstance();
    const saved   = service.handleHashCallback();

    if (!saved) {
      setErrorMsg(ERROR_MESSAGES.unknown);
      setStatus('error');
      return;
    }

    service.getProfile()
      .then((profile) => { setDisplayName(profile.display_name); setStatus('success'); })
      .catch(() => { setStatus('success'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'success') return;
    if (countdown <= 0) { router.replace('/session'); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown, router]);

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <h1 className="sr-only">Connecting Spotify</h1>

        {status === 'loading' && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-border border-t-[#1DB954] animate-spin" />
            <span className="text-sm">Connecting…</span>
          </div>
        )}

        {status === 'success' && (
          <div>
            <p className="text-2xl font-black">{displayName ?? 'Connected'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Spotify linked. Heading to session in {countdown}s.
            </p>
            <Link
              href="/session"
              className="mt-6 inline-block rounded-xl bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#1ed760]"
            >
              Go now
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div>
            <p className="text-2xl font-black">Failed</p>
            <p className="mt-1 text-sm text-muted-foreground">{errorMsg}</p>
            <div className="mt-6 flex gap-3">
              {/* A plain link: the login route redirects to Spotify, so it must load as a page. Next's Link
                  would prefetch it as soon as it shows, starting a login, and the CSP blocks that fetch. */}
              <a
                href="/api/spotify/login"
                className="rounded-xl bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#1ed760]"
              >
                Try again
              </a>
              <Link
                href="/session"
                className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function SpotifyCallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}
