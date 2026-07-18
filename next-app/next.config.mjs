/** @type {import('next').NextConfig} */
const nextConfig = {
  // firebase-admin must NOT be bundled by Turbopack — its native/optional deps
  // (gRPC, etc.) break in the bundled output and crash route handlers at
  // runtime on Vercel (works in `next dev`, 500s in production). Externalizing
  // it makes the server require() it from node_modules instead.
  // @neondatabase/serverless + ws (Postgres driver) are externalized for the
  // same reason: ws has optional native deps and the driver is server-only.
  serverExternalPackages: ['firebase-admin', '@neondatabase/serverless', 'ws'],
  // Dev-only: lets devices on the LAN (e.g. a phone) load the dev server's
  // /_next resources. Production builds ignore this.
  allowedDevOrigins: ['192.168.140.62'],
  async headers() {
    return [
      {
        // The face model (23 MB) + wasm runtimes must hit the browser HTTP
        // cache on repeat visits (Next serves public/ uncached by default).
        // If a model file is ever swapped, rename it — the URL is immutable.
        source: '/models/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
