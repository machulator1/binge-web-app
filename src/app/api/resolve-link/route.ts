import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function extractYouTubeId(url: URL) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  const isYouTubeHost =
    host.includes("youtube.com") || host.includes("youtu.be") || host.includes("youtube-nocookie.com");
  if (!isYouTubeHost) return null;

  if (host.includes("youtu.be")) {
    const id = path.split("/").filter(Boolean)[0] ?? "";
    return id.trim() ? id.trim() : null;
  }

  const v = (url.searchParams.get("v") ?? "").trim();
  if (v) return v;

  const parts = path.split("/").filter(Boolean);
  const markerIdx = parts.findIndex((p) => ["shorts", "embed", "live"].includes(p.toLowerCase()));
  if (markerIdx >= 0) {
    const id = parts[markerIdx + 1] ?? "";
    return id.trim() ? id.trim() : null;
  }

  return null;
}

function parseIso8601DurationMinutes(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  if (totalSeconds <= 0) return null;
  return Math.max(1, Math.round(totalSeconds / 60));
}

async function fetchYouTubeDataApi(videoId: string, apiKey: string) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(
    videoId,
  )}&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: Array<{
      snippet?: {
        title?: string;
        description?: string;
        thumbnails?: Record<string, { url?: string }>;
        channelTitle?: string;
      };
      contentDetails?: {
        duration?: string;
      };
    }>;
  };

  const item = Array.isArray(data.items) ? data.items[0] : undefined;
  const title = (item?.snippet?.title ?? "").trim();
  const description = (item?.snippet?.description ?? "").trim();

  const thumbs = item?.snippet?.thumbnails ?? {};
  const image =
    thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;

  const durationMinutes = parseIso8601DurationMinutes(item?.contentDetails?.duration) ?? null;
  const channelTitle = (item?.snippet?.channelTitle ?? "").trim();

  if (!title) return null;

  return {
    title,
    description: description ? description : null,
    image,
    durationMinutes,
    channelTitle: channelTitle ? channelTitle : null,
  };
}

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

function isGenericYouTubeTitle(value: string) {
  const v = value.trim();
  if (!v) return true;
  if (/^youtube$/i.test(v)) return true;
  if (/\byoutube\b/i.test(v) && /\s-\sYouTube$/i.test(v)) return true;
  if (/^watch\s+on\s+youtube$/i.test(v)) return true;
  return false;
}

function isGenericYouTubeDescription(value: string) {
  const v = value.trim();
  if (!v) return true;
  if (/enjoy the videos and music you love/i.test(v)) return true;
  if (/youtube is a/i.test(v) && /video/i.test(v)) return true;
  if (/watch videos/i.test(v) && /youtube/i.test(v)) return true;
  return false;
}

function extractJsonObjectAfterMarker(html: string, marker: string) {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;

  const braceStart = html.indexOf("{", idx);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      const slice = html.slice(braceStart, i + 1);
      try {
        return JSON.parse(slice) as unknown;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function extractYouTubeVideoDetails(html: string) {
  const parsed = extractJsonObjectAfterMarker(html, "ytInitialPlayerResponse");
  if (!parsed || typeof parsed !== "object") return null;

  const root = parsed as { videoDetails?: { title?: string; shortDescription?: string } };
  const details = root.videoDetails;
  if (!details) return null;

  const title = (details.title ?? "").trim();
  const description = (details.shortDescription ?? "").trim();
  return {
    title: title ? title : null,
    description: description ? description : null,
  };
}

async function fetchHtml(url: string, extraHeaders?: Record<string, string>) {
  const res = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      "user-agent": "binge/0.1 (metadata resolver)",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      ...(extraHeaders ?? {}),
    },
  });

  if (!res.ok) return null;
  return await res.text();
}

async function fetchYouTubeHtml(inputUrl: string, youtubeId: string) {
  const consentCookie = {
    cookie: "CONSENT=YES+1;",
  };

  const primary = await fetchHtml(inputUrl, consentCookie);
  if (primary) return primary;

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}&hl=en&gl=US`;
  const watch = await fetchHtml(watchUrl, consentCookie);
  if (watch) return watch;

  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?hl=en`;
  const embed = await fetchHtml(embedUrl, consentCookie);
  if (embed) return embed;

  return null;
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
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html))) {
    const tag = match[0] ?? "";
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const dataSrcMatch = tag.match(/\bdata-(?:lazy-)?src=["']([^"']+)["']/i);
    const srcSetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);

    const candidates: string[] = [];
    if (srcMatch?.[1]) candidates.push(srcMatch[1]);
    if (dataSrcMatch?.[1]) candidates.push(dataSrcMatch[1]);

    if (srcSetMatch?.[1]) {
      const first = srcSetMatch[1]
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)[0];
      if (first) candidates.push(first);
    }

    for (const c of candidates) {
      const resolved = resolveUrl(c, baseUrl);
      if (!resolved) continue;
      if (!isLikelyImageUrl(resolved)) continue;
      return resolved;
    }
  }
  return null;
}

function extractJsonLdImages(html: string) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi);
  if (!scripts || scripts.length === 0) return [];

  const out: string[] = [];
  for (const block of scripts) {
    const content = block
      .replace(/^[\s\S]*?>/i, "")
      .replace(/<\/script>\s*$/i, "")
      .trim();
    if (!content) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      continue;
    }

    const stack: unknown[] = [parsed];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;

      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
        continue;
      }

      if (typeof cur !== "object") continue;
      const obj = cur as Record<string, unknown>;

      const image = obj.image;
      if (typeof image === "string") out.push(image);
      if (Array.isArray(image)) {
        for (const v of image) if (typeof v === "string") out.push(v);
      }
      if (image && typeof image === "object") {
        const maybeUrl = (image as Record<string, unknown>).url;
        if (typeof maybeUrl === "string") out.push(maybeUrl);
      }

      for (const v of Object.values(obj)) stack.push(v);
    }
  }

  return out;
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

    const youtubeId = modality === "video" ? extractYouTubeId(parsed) : null;

    if (youtubeId) {
      const apiKey = (process.env.YOUTUBE_API_KEY ?? "").trim();
      if (apiKey) {
        try {
          const yt = await fetchYouTubeDataApi(youtubeId, apiKey);
          if (yt) {
            const youtubeFallbackImage = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
            return NextResponse.json<ResolvedLink>({
              url: input,
              canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`,
              title: yt.title,
              description: yt.description ?? undefined,
              image: yt.image ?? youtubeFallbackImage,
              source: "YouTube",
              modality: "video",
              provider: "youtube",
              durationMinutes: yt.durationMinutes ?? undefined,
            });
          }
        } catch {
          // Fall back to non-API resolver
        }
      }
    }

    const html = youtubeId ? await fetchYouTubeHtml(input, youtubeId) : await fetchHtml(input);
    if (!html) {
      return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }

    let ytDetails = youtubeId ? extractYouTubeVideoDetails(html) : null;

    const ogOrDocTitleRaw = extractTitle(html) ?? "";
    const ogOrDocTitle = ogOrDocTitleRaw.replace(/\s-\sYouTube$/i, "").trim();
    const title =
      youtubeId && isGenericYouTubeTitle(ogOrDocTitle)
        ? (ytDetails?.title ?? "")
        : ogOrDocTitle;

    const ogOrMetaDescription = extractDescription(html) ?? null;

    const ogLooksGeneric = youtubeId && ogOrMetaDescription ? isGenericYouTubeDescription(ogOrMetaDescription) : false;
    const titleLooksGeneric = youtubeId ? isGenericYouTubeTitle(ogOrDocTitle) : false;

    if (youtubeId && (titleLooksGeneric || ogLooksGeneric) && !ytDetails) {
      const retryUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}&hl=en&gl=US`;
      const retryHtml = await fetchYouTubeHtml(retryUrl, youtubeId);
      if (retryHtml) {
        ytDetails = extractYouTubeVideoDetails(retryHtml);
      }
    }

    const descriptionFromYouTube = youtubeId
      ? (ytDetails?.description ?? extractYouTubeShortDescription(html))
      : null;

    const description = youtubeId
      ? (ogOrMetaDescription && !ogLooksGeneric
          ? ogOrMetaDescription
          : descriptionFromYouTube ?? undefined)
      : (ogOrMetaDescription ?? undefined);

    const safeDescription = youtubeId && description ? (isGenericYouTubeDescription(description) ? undefined : description) : description;
    const canon = canonicalUrl(html) ?? undefined;
    const baseForImages = canon ?? input;
    const ogImageRaw = extractImage(html);
    const ogImage = ogImageRaw ? resolveUrl(ogImageRaw, baseForImages) : null;
    const imageFromOg = ogImage && isLikelyImageUrl(ogImage) ? ogImage : null;
    const imageFromPage = imageFromOg ? null : extractFirstImage(html, baseForImages);

    const jsonLdCandidates = imageFromOg || imageFromPage ? [] : extractJsonLdImages(html);
    const imageFromJsonLd =
      jsonLdCandidates
        .map((c) => resolveUrl(c, baseForImages))
        .find((c): c is string => Boolean(c && isLikelyImageUrl(c))) ?? null;

    const youtubeFallbackImage = youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null;
    const image =
      imageFromOg ??
      imageFromPage ??
      imageFromJsonLd ??
      youtubeFallbackImage ??
      domainThumbSvg({ hostname: parsed.hostname, modality });

    return NextResponse.json<ResolvedLink>({
      url: input,
      canonicalUrl: canon,
      title,
      description: safeDescription,
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
