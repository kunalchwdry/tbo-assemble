import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  async headers() {
    const noStore = [
      { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
    ];
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ] },
      ...['/api/events/:path*', '/api/guests/:path*', '/api/bookings/:path*', '/event/:path*', '/secure-account/:path*', '/dashboard/:path*'].map(source => ({ source, headers: noStore })),
    ];
  },
};

export default nextConfig;
