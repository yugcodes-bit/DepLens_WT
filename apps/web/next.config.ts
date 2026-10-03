import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: ['@deplens/db'],
  // Native modules must not be bundled: argon2 is a native addon and pg opens real sockets.
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS: the deployment is HTTPS-only (NFR-D1).
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default config;
