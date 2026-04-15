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

function extractOgTag(html: string, property: string) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  return m?.[1] ?? null;
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
  const og = extractOgTag(html, "og:image");
  if (og) return og;
  return null;
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

    if (modality === "video") {
      const id =
        parsed.hostname.toLowerCase().includes("youtu.be")
          ? parsed.pathname.split("/").filter(Boolean)[0]
          : parsed.searchParams.get("v");

      if (id) {
        const image = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        return NextResponse.json<ResolvedLink>({
          url: input,
          canonicalUrl: input,
          title: "",
          description: undefined,
          image,
          source: "YouTube",
          modality,
          provider: "youtube",
        });
      }
    }

    const res = await fetch(input, {
      redirect: "follow",
      headers: {
        "user-agent": "binge/0.1 (metadata resolver)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
    }

    const html = await res.text();

    const title = extractTitle(html) ?? "";
    const description = extractDescription(html) ?? undefined;
    const image = extractImage(html) ?? undefined;
    const canon = canonicalUrl(html) ?? undefined;

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
