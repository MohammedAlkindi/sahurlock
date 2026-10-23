// Scripts and model files come only from this origin, plus the Spotify Web
// Playback SDK. 'unsafe-eval' is required by MediaPipe: its Emscripten runtime
// compiles WebAssembly and builds functions with new Function() during init, and
// Chromium blocks both without it. 'unsafe-inline' covers the inline bootstrap
// scripts and styles that Next.js and framer-motion emit.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.scdn.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.scdn.co https://*.spotifycdn.com",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.spotify.com",
  "frame-src https://sdk.scdn.co",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app uses no next/image, so the image optimizer endpoint would only add
  // attack surface. Keep it off.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/media/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=self, microphone=()' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy }
        ]
      }
    ];
  }
};

export default nextConfig;
