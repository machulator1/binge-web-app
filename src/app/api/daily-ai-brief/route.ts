import { NextResponse } from "next/server";

type BriefStory = {
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  thumbnailUrl?: string;
  readingTimeMinutes: number;
  publishedAt?: string;
};

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

function estimateMinutes(text: string) {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
  const minutes = Math.ceil(words / 200);
  return Math.min(18, Math.max(2, minutes));
}

type AlgoliaHit = {
  objectID: string;
  title: string | null;
  url: string | null;
  created_at: string;
};

type AlgoliaResponse = {
  hits: AlgoliaHit[];
};

async function fetchAlgolia(query: string, hitsPerPage: number) {
  const u = new URL("https://hn.algolia.com/api/v1/search_by_date");
  u.searchParams.set("query", query);
  u.searchParams.set("tags", "story");
  u.searchParams.set("hitsPerPage", String(hitsPerPage));

  const res = await fetch(u.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "binge/0.1 (daily ai brief)",
    },
    next: { revalidate: 60 * 30 },
  });

  if (!res.ok) throw new Error("Algolia fetch failed");
  return (await res.json()) as AlgoliaResponse;
}

async function enrichUrl(url: string) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "binge/0.1 (daily ai brief metadata)",
        accept: "text/html,application/xhtml+xml",
      },
      next: { revalidate: 60 * 60 },
    });

    if (!res.ok) return null;
    const html = await res.text();

    return {
      title: extractTitle(html) ?? undefined,
      summary: extractDescription(html) ?? undefined,
      thumbnailUrl: extractImage(html) ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const queries = [
      "artificial intelligence",
      "generative ai",
      "LLM",
      "openai",
    ];

    const results = await Promise.allSettled(queries.map((q) => fetchAlgolia(q, 8)));

    const seen = new Set<string>();
    const base: Array<{ id: string; title: string; url: string; publishedAt: string }> = [];

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const hit of r.value.hits) {
        const url = (hit.url ?? "").trim();
        const title = (hit.title ?? "").trim();
        if (!url || !title) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        base.push({ id: hit.objectID, title, url, publishedAt: hit.created_at });
      }
    }

    const picked = base.slice(0, 10);

    const enriched = await Promise.all(
      picked.map(async (it) => {
        const meta = await enrichUrl(it.url);
        const host = new URL(it.url).hostname;
        const title = meta?.title?.trim() ? meta.title.trim() : it.title;
        const summary = meta?.summary?.trim() ? meta.summary.trim() : undefined;
        const readingTimeMinutes = estimateMinutes(`${title} ${summary ?? ""}`);

        const story: BriefStory = {
          id: `ai_${it.id}`,
          title,
          url: it.url,
          source: hostLabel(host),
          summary,
          thumbnailUrl: meta?.thumbnailUrl ?? undefined,
          readingTimeMinutes,
          publishedAt: it.publishedAt,
        };

        return story;
      }),
    );

    return NextResponse.json(
      {
        date: new Date().toISOString().slice(0, 10),
        stories: enriched,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Failed to load Daily AI Brief" }, { status: 500 });
  }
}
