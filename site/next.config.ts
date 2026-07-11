import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cache-Fix: Turbopack (Next 16) hasht CSS-Chunks NICHT content-basiert
  // (gleicher Dateiname über Builds). Zusammen mit dem Default 'immutable'
  // cachen Browser altes CSS dauerhaft → Design-Änderungen kamen nie an.
  // Betrifft CSS UND JS gleichermassen → alle Chunks revalidieren (ETag → 304).
  async headers() {
    return [
      {
        source: "/_next/static/chunks/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
