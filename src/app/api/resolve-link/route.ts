import { NextResponse } from "next/server";

type Modality = "article" | "video" | "podcast";

type ResolvedLink = {
  url: string;
  title: string;
  description?: string;
  image?: string;
  source?: string;
  modality: Modality;
  durationMinutes?: number;
  provider?: string;
  canonicalUrl?: string;
};

function guessModalityFromUrl(url: URL): Modality {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("vimeo.com")) {
    return "video";
  }

  if (
    host.includes("spotify.com") ||
    host.includes("podcasts.apple.com") ||
    host.includes("soundcloud.com")
  ) {
    return "podcast";
  }

  if (path.endsWith(".pdf")) return "article";
  return "article";
}

function hostLabel(hostname: string) {
  const parts = hostname.split(".").filter(Boolean);
  const core = parts.length >= 2 ? parts[parts.length - 2] : hostname;
  return core
    .split(/[-_]/g)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x3A;/gi, ":")
    .replace(/&#x3D;/gi, "=");
}

function decodeJsonStringLiteral(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  try {
    return JSON.parse(`"${raw.replace(/\\"/g, '\\\\"')}"`) as string;
  } catch {
    try {
      return raw
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, "\t")
        .replace(/\\u0026/g, "&")
        .replace(/\\u003c/g, "<")
        .replace(/\\u003e/g, ">")
        .replace(/\\u003d/g, "=")
        .replace(/\\\\/g, "\\");
    } catch {
      return null;
    }
  }
}

function extractYouTubeShortDescription(html: string) {
  const m = html.match(/\bshortDescription\":\"([^\"]+)\"/i);
  const captured = m?.[1];
  if (!captured) return null;
  const decoded = decodeJsonStringLiteral(captured);
  const trimmed = (decoded ?? "").trim();
  return trimmed ? trimmed : null;
}

function extractOgTag(html: string, property: string) {
  const metaRe = new RegExp(
    `<meta\\b[^>]*?(?:property|name)=["']${property}["'][^>]*?>`,
    "i",
  );
  const metaMatch = html.match(metaRe);
  const tag = metaMatch?.[0];
  if (!tag) return null;

  const contentMatch = tag.match(/\\bcontent=["']([^"']+)["']/i);
  const content = contentMatch?.[1]?.trim();
  if (!content) return null;
  return decodeHtmlEntities(content);
}

function firstMetaContent(html: string, properties: string[]) {
  for (const p of properties) {
    const v = extractOgTag(html, p);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function resolveUrl(candidate: string, baseUrl: string) {
  const raw = candidate.trim();
  if (!raw) return null;

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function isLikelyImageUrl(value: string) {
  const v = value.trim();
  if (!v) return false;
  if (/^data:/i.test(v)) return false;

  try {
    const u = new URL(v);
    if (!(u.protocol === "http:" || u.protocol === "https:")) return false;

    const lower = u.pathname.toLowerCase();
    if (lower.endsWith(".svg")) return false;
    if (lower.includes("favicon") || lower.includes("sprite")) return false;
    return true;
  } catch {
    return false;
  }
}

function extractFirstImage(html: string, baseUrl: string) {
  const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html))) {
    const src = match[1] ?? "";
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved) continue;
    if (!isLikelyImageUrl(resolved)) continue;
    return resolved;
  }
  return null;
}

function domainThumbSvg({ hostname, modality }: { hostname: string; modality: Modality }) {
  const safeHost = hostname.replace(/^www\./i, "");
  const label = modality === "video" ? "Video" : modality === "podcast" ? "Podcast" : "Article";
  const seed = Array.from(safeHost).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = seed % 360;
  const hue2 = (hue + 36) % 360;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="hsl(${hue} 70% 20%)"/>
          <stop offset="0.65" stop-color="hsl(${hue2} 70% 26%)"/>
          <stop offset="1" stop-color="#0a0a0a"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="675" rx="90" fill="url(#g)"/>
      <rect x="70" y="70" width="1060" height="535" rx="66" fill="rgba(255,255,255,0.06)"/>
      <text x="120" y="170" font-family="ui-sans-serif, system-ui, -apple-system" font-size="44" font-weight="700" fill="rgba(255,255,255,0.92)">${label}</text>
      <text x="120" y="240" font-family="ui-sans-serif, system-ui, -apple-system" font-size="34" font-weight="600" fill="rgba(255,255,255,0.72)">${safeHost}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function extractTitle(html: string) {
  const og = extractOgTag(html, "og:title");
  if (og) return og;
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m?.[1]?.trim() ?? null;
}

function extractDescription(html: string) {
  const og = extractOgTag(html, "og:description");
  if (og) return og;
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return m?.[1]?.trim() ?? null;
}

function extractImage(html: string) {
  const raw = firstMetaContent(html, [
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
  ]);
  if (!raw) return null;
  return raw;
}

function canonicalUrl(html: string) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  return m?.[1]?.trim() ?? null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string };
    const input = (body.url ?? "").trim();
    if (!input) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    const modality = guessModalityFromUrl(parsed);
    const source = hostLabel(parsed.hostname);

    const youtubeId =
      modality === "video"
        ? parsed.hostname.toLowerCase().includes("youtu.be")
          ? parsed.pathname.split("/").filter(Boolean)[0]
          : parsed.searchParams.get("v")
        : null;

    const res = await fetch(input, {
      redirect: "follow",
      headers: {
        "user-agent": "binge/0.1 (metadata resolver)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }

    const html = await res.text();

    const title = extractTitle(html) ?? "";
    const ogOrMetaDescription = extractDescription(html) ?? null;
    const descriptionFromYouTube = youtubeId ? extractYouTubeShortDescription(html) : null;
    const description = (ogOrMetaDescription ?? descriptionFromYouTube ?? undefined) ?? undefined;
    const canon = canonicalUrl(html) ?? undefined;
    const baseForImages = canon ?? input;
    const ogImageRaw = extractImage(html);
    const ogImage = ogImageRaw ? resolveUrl(ogImageRaw, baseForImages) : null;
    const imageFromOg = ogImage && isLikelyImageUrl(ogImage) ? ogImage : null;
    const imageFromPage = imageFromOg ? null : extractFirstImage(html, baseForImages);

    const youtubeFallbackImage = youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null;
    const image =
      imageFromOg ?? imageFromPage ?? youtubeFallbackImage ?? domainThumbSvg({ hostname: parsed.hostname, modality });

    return NextResponse.json<ResolvedLink>({
      url: input,
      canonicalUrl: canon,
      title,
      description,
      image,
      source,
      modality,
      provider: undefined,
      durationMinutes: undefined,
    });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
