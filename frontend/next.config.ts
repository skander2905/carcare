import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* Emits a self-contained server bundle with only the traced dependencies,
     which is what keeps the production image small instead of shipping the
     whole pnpm store. */
  output: 'standalone',

  /* In a monorepo, tracing must start at the workspace root or Next misses
     dependencies that pnpm hoisted above frontend/node_modules. */
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,

  reactStrictMode: true,

  /* Lets a phone on the same network open the dev server, e.g.
     http://192.168.1.28:3000. Development only; Next ignores it in production. */
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '*.local'],

  /* Do not leak framework details in response headers. */
  poweredByHeader: false,

  /*
   * Online, the browser talks to one address only: this site. `/api/*` and
   * the health probes are forwarded to the API (API_PROXY_TARGET, e.g. the
   * Render service). One address makes the refresh cookie first-party — Safari
   * drops cookies from another site, which would sign iPhone users out on
   * every visit — and leaves no CORS to configure. Unset locally, where the
   * browser calls the API directly.
   */
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');
    if (!target) return [];
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/health', destination: `${target}/health` },
      { source: '/health/:path*', destination: `${target}/health/:path*` },
    ];
  },
};

export default nextConfig;
