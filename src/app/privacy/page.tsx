import type { Metadata } from 'next';
import { DocumentPage } from '@/components/document-page';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What SahurLock keeps on your device, what reaches a server, and the cookies it sets.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <DocumentPage title="Privacy" updated="26 October 2026">
      <p>
        SahurLock has no accounts and no database. What you make in it stays in your browser, and the camera
        picture never leaves your device.
      </p>

      <h2>What stays on your device</h2>
      <ul>
        <li>Sessions, stats, tasks, notes, flashcards, your schedule and settings are saved in this browser&apos;s local storage.</li>
        <li>Saved scans and a custom alert clip are saved in this browser&apos;s IndexedDB.</li>
        <li>
          During a focus session, a face tracking model runs in your browser and reads the webcam picture to tell
          whether you are looking at the screen. Camera frames are not uploaded or saved.
        </li>
        <li>Scan cleans up your photos and PDFs in your browser. They are not uploaded.</li>
      </ul>
      <p>
        Nobody else can see this data, including the person who runs SahurLock. It also means a different
        browser or device starts empty, and clearing your browser&apos;s site data deletes it.
      </p>

      <h2>What reaches a server</h2>
      <ul>
        <li>
          <strong>Hosting.</strong> Vercel serves the site. Like any web host, it receives your IP address and
          browser details with each request and keeps request logs for a limited time.
        </li>
        <li>
          <strong>Page view statistics.</strong> Vercel Web Analytics records each page view: the time, the page
          address with some of its query parameters, the site you came from, your approximate location (country,
          region and city), your browser and operating system with their versions, and your device type. It sets no
          cookies. To count visitors, it uses a hash of your request that it discards after 24 hours. See <a href="https://vercel.com/docs/analytics/privacy-policy">how Vercel Web
          Analytics handles data</a>.
        </li>
        <li>
          <strong>Spotify, only if you connect it.</strong> You sign in on Spotify&apos;s own site. SahurLock&apos;s
          server swaps the sign-in code for tokens and does not store them: the long-lived token goes into a cookie
          that only your browser holds, and the short-lived one into local storage. Music, your Spotify name and
          playlists then pass between your browser and Spotify. <a href="https://www.spotify.com/legal/privacy-policy/">Spotify&apos;s privacy policy</a> covers
          what Spotify does with that.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>SahurLock sets cookies only when you connect Spotify, and only to make that work:</p>
      <ul>
        <li><code>spotify_auth_state</code> and <code>spotify_code_verifier</code> protect the sign-in and expire after 10 minutes.</li>
        <li><code>spotify_refresh</code> keeps you connected for up to 180 days. It is sent only to SahurLock&apos;s Spotify routes, and page scripts cannot read it.</li>
      </ul>
      <p>There are no advertising or tracking cookies, so there is nothing to accept or decline.</p>

      <h2>Deleting your data</h2>
      <p>
        Settings has <strong>Clear everything</strong>, which deletes what SahurLock saved in this browser and
        disconnects Spotify. Before you clear, Export in Settings saves your sessions, stats, tasks, notes,
        flashcards, templates, goals, schedule and settings to a file. Saved scans and an uploaded alert clip are not in that file, so
        save any scan you want to keep as a PDF from Scan first. Disconnecting Spotify, from Sounds or a focus
        session, removes the Spotify tokens.
      </p>

      <h2>Changes and questions</h2>
      <p>
        If this changes, this page will say so and the date at the top will change. Questions go to{' '}
        <a href="https://github.com/MohammedAlkindi/sahurlock/issues">the project&apos;s GitHub issues</a>, where the
        source code is public too.
      </p>
    </DocumentPage>
  );
}
