import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;
  const cleanY = y.replace(/\.png$/, "");

  const headers = {
    "User-Agent": "TBO-Assemble-App/1.0 (https://tbo-assemble.vercel.app; contact@tboassemble.local)",
    Referer: "https://tbo-assemble.vercel.app/",
  };

  const tileUrls = [
    `https://tile.openstreetmap.org/${z}/${x}/${cleanY}.png`,
    `https://a.tile.openstreetmap.fr/osmfr/${z}/${x}/${cleanY}.png`,
  ];

  for (const url of tileUrls) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const buffer = await res.arrayBuffer();
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
            "CDN-Cache-Control": "public, max-age=604800",
            "Vercel-CDN-Cache-Control": "public, max-age=604800",
          },
        });
      }
    } catch {
      // Try next mirror
    }
  }

  return new NextResponse(null, { status: 502 });
}
