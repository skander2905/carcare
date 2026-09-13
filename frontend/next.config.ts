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

  /* Do not leak framework details in response headers. */
  poweredByHeader: false,
};

export default nextConfig;
