import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentPage } from '@/components/document-page';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms for using SahurLock: free, open source, provided as is, and your content stays yours.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <DocumentPage title="Terms" updated="26 October 2026">
      <p>By using SahurLock you agree to these terms. They are short because the app is simple: it is free and runs in your browser.</p>

      <h2>Free and open source</h2>
      <p>
        SahurLock costs nothing and has no paid plan. Its source code is published on{' '}
        <a href="https://github.com/MohammedAlkindi/sahurlock">GitHub</a> under the MIT License, which lets you use,
        copy, change and share it.
      </p>

      <h2>Provided as is</h2>
      <p>
        SahurLock comes with no warranty of any kind, as the MIT License says. It can have bugs, and it can lose
        data if your browser clears its storage. Keep your own copy of anything important: Export in Settings saves
        your data to a file, and Scan saves pages as a PDF.
      </p>
      <p>
        The attention check is an estimate from your webcam picture and can be wrong. SahurLock is a study aid, not
        medical or psychological advice.
      </p>

      <h2>Your content</h2>
      <p>
        Notes, tasks, scans and everything else you make belong to you. They stay in your browser, so nobody else
        gets a copy. The <Link href="/privacy">privacy page</Link> explains what reaches a server.
      </p>

      <h2>Using it fairly</h2>
      <ul>
        <li>Use the camera features on yourself, not to watch other people without their consent.</li>
        <li>Do not try to break, overload or misuse the site or its Spotify connection.</li>
        <li>Spotify features are subject to Spotify&apos;s own terms, and playback needs Spotify Premium.</li>
      </ul>

      <h2>Changes and questions</h2>
      <p>
        These terms can change as the app does. This page will show the new date when they do. Questions go to{' '}
        <a href="https://github.com/MohammedAlkindi/sahurlock/issues">the project&apos;s GitHub issues</a>.
      </p>
    </DocumentPage>
  );
}
