/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The in-browser Whisper fallback ships onnxruntime-web's ES-module bundle
  // (it contains `import.meta`). Next 14's default SWC minifier parses emitted
  // .mjs assets as plain scripts and fails the production build on it, so this
  // project minifies with Terser (which understands modules) instead.
  swcMinify: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  // In-browser Whisper fallback for Speaking Club (@huggingface/transformers,
  // see lib/speaking-whisper.worker.ts). The library has Node-only optional
  // dependencies that must not be bundled for the browser.
  // OPT-IN multi-thread WASM for the in-browser Whisper: only the call room gets the
  // cross-origin-isolation headers, so login / the rest of the site are untouched.
  // `credentialless` (not require-corp) keeps cross-origin images working.
  // Chrome/Android honour it; iOS Safari does not, and simply stays single-thread.
  async headers() {
    if (process.env.NEXT_PUBLIC_WHISPER_MULTITHREAD !== "true") return [];
    return [
      {
        source: "/speaking-club/room/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
    };
    return config;
  },
};

export default nextConfig;
