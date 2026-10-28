// Scripts and model files come only from this origin, plus the Spotify Web
// Playback SDK. 'unsafe-eval' is required by MediaPipe: its Emscripten runtime
// compiles WebAssembly and builds functions with new Function() during init, and
// Chromium blocks both without it. ONNX Runtime, in the model worker, compiles
// WebAssembly too, so dropping 'unsafe-eval' would need 'wasm-unsafe-eval' in its
// place. 'unsafe-inline' covers the inline bootstrap scripts and styles that
// Next.js and framer-motion emit.
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
  // Without this, `next dev` adds its own block to AGENTS.md whenever an AI agent runs it. The
  // project's agent instructions are written by hand.
  agentRules: false,
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
        // The version is in the path, so these never change. The model worker imports them by
        // address, so only this HTTP cache lets a worker started offline find them.
        source: '/vendor/onnxruntime-web/:version/:file',
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
