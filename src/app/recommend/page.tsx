"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useMemo } from "react";

type Modality = "article" | "video" | "podcast";

type QueueItem = {
  id: string;
  title: string;
  url: string;
  modality: Modality;
  durationMinutes: number;
  source: string;
  savedBy: string;
  status: "saved" | "in_progress" | "consumed";
  dateSaved: string;
  thumbnailUrl: string;
  description?: string;
  notes?: string;
};

type Intent = {
  availableMinutes: number | null;
  modality: Modality | null;
  savedBy: string | null;
  topic: string | null;
  social: "alone" | "together" | null;
  friendsOnly: boolean;
};

const SAVED_ITEMS_STORAGE_KEY = "binge_saved_items_v1";

const MODALITY_LABEL: Record<Modality, string> = {
  article: "Article",
  video: "Video",
  podcast: "Podcast",
};

const MODALITY_PILL: Record<Modality, string> = {
  article: "bg-blue-50 text-blue-700 ring-blue-200",
  video: "bg-purple-50 text-purple-700 ring-purple-200",
  podcast: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

function extractMinutes(q: string) {
  const match = q.match(/(\d{1,3})\s*(min|mins|minute|minutes)/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function inferModality(q: string): Modality | null {
  const s = q.toLowerCase();
  if (/(podcast|listen|listening|audio)/.test(s)) return "podcast";
  if (/(video|watch|watching|youtube)/.test(s)) return "video";
  if (/(article|read|reading)/.test(s)) return "article";
  return null;
}

function inferSavedBy(q: string) {
  const s = q.toLowerCase();
  const candidates = ["rob", "ava", "jordan", "me"];
  for (const c of candidates) {
    if (s.includes(c)) return c === "me" ? "Me" : c[0].toUpperCase() + c.slice(1);
  }
  return null;
}

function inferSocial(q: string): Intent["social"] {
  const s = q.toLowerCase();
  if (/(together|with friends|with my friends|group)/.test(s)) return "together";
  if (/(alone|by myself|solo)/.test(s)) return "alone";
  return null;
}

function inferFriendsOnly(q: string) {
  const s = q.toLowerCase();
  return /(shared by friends|from friends|friends shared|friends)/.test(s);
}

function inferTopic(q: string) {
  const s = q.toLowerCase();
  if (/(ai|artificial intelligence|ml|machine learning|llm|agent|agents|prompt|prompts)/.test(s)) {
    return "AI";
  }
  if (/(product strategy|product|pm|roadmap)/.test(s)) return "Product";
  if (/(design|ui|ux)/.test(s)) return "Design";
  if (/(health|fitness|mobility)/.test(s)) return "Health";
  return null;
}

function parseIntent(query: string): Intent {
  return {
    availableMinutes: extractMinutes(query),
    modality: inferModality(query),
    savedBy: inferSavedBy(query),
    topic: inferTopic(query),
    social: inferSocial(query),
    friendsOnly: inferFriendsOnly(query),
  };
}

function matchesTopic(item: QueueItem, topic: string) {
  const t = topic.toLowerCase();
  const hay = `${item.title} ${(item.description ?? "")} ${(item.notes ?? "")}`.toLowerCase();
  if (t === "ai") return /(ai|agent|agents|llm|prompt|prompts|ml|machine learning)/.test(hay);
  if (t === "product") return /(product|pm|roadmap|strategy)/.test(hay);
  if (t === "design") return /(design|ui|ux|interface)/.test(hay);
  if (t === "health") return /(health|mobility|fitness|shoulder|neck)/.test(hay);
  return hay.includes(t);
}

function matchHeader(query: string, intent: Intent) {
  const parts: string[] = [];

  if (intent.availableMinutes) parts.push(`${intent.availableMinutes} min`);
  if (intent.friendsOnly) parts.push("from friends");
  if (intent.social === "together") parts.push("together");
  if (intent.social === "alone") parts.push("solo");
  if (intent.modality) parts.push(MODALITY_LABEL[intent.modality].toLowerCase());
  if (intent.topic) parts.push(intent.topic);
  if (intent.savedBy) parts.push(`from ${intent.savedBy}`);

  if (parts.length === 0) return query ? `“${query}”` : "Your library";
  return parts.join(" • ");
}

function cacheForContentPage(item: QueueItem) {
  try {
    window.sessionStorage.setItem(`binge_content_item_${item.id}`, JSON.stringify(item));
  } catch {
    // Ignore
  }
}

function thumbFallback(item: QueueItem) {
  const accent = item.modality === "video" ? "#8b5cf6" : item.modality === "podcast" ? "#10b981" : "#3b82f6";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0a0a0a"/>
          <stop offset="0.6" stop-color="#3f3f46"/>
          <stop offset="1" stop-color="${accent}"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="675" rx="90" fill="url(#g)"/>
    </svg>
  `.trim();

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function reasoningText(item: QueueItem, intent: Intent) {
  const reasons: string[] = [];
  if (intent.availableMinutes !== null) {
    if (item.durationMinutes <= intent.availableMinutes) reasons.push(`Fits your ${intent.availableMinutes}-minute window`);
    else reasons.push(`Slightly longer (${item.durationMinutes} min)`);
  }

  if (intent.friendsOnly && item.savedBy !== "Me") reasons.push("Shared by a friend");
  if (intent.savedBy && item.savedBy === intent.savedBy) reasons.push(`Shared by ${item.savedBy}`);
  if (intent.modality && item.modality === intent.modality) reasons.push(`Matches ${MODALITY_LABEL[item.modality].toLowerCase()}`);
  if (intent.topic && matchesTopic(item, intent.topic)) reasons.push(`Matches ${intent.topic}`);
  if (reasons.length === 0) reasons.push(`From ${item.source}`);
  return reasons.slice(0, 2).join(" — ");
}

function progressiveResults(items: QueueItem[], intent: Intent) {
  const base = [...items].filter((it) => it.status !== "consumed");
  const availableMinutes = intent.availableMinutes;
  const topic = intent.topic;
  const steps: Array<{ name: string; apply: (arr: QueueItem[]) => QueueItem[] }> = [
    {
      name: "time",
      apply: (arr) =>
        availableMinutes !== null
          ? arr.filter((it) => it.durationMinutes <= availableMinutes)
          : arr,
    },
    {
      name: "social",
      apply: (arr) => {
        const afterFriends = intent.friendsOnly ? arr.filter((it) => it.savedBy !== "Me") : arr;
        if (afterFriends.length === 0) return afterFriends;
        if (!intent.social) return afterFriends;
        if (intent.social === "together") return afterFriends.filter((it) => it.modality !== "article");
        return afterFriends;
      },
    },
    {
      name: "modality",
      apply: (arr) => (intent.modality ? arr.filter((it) => it.modality === intent.modality) : arr),
    },
    {
      name: "topic",
      apply: (arr) => (topic ? arr.filter((it) => matchesTopic(it, topic)) : arr),
    },
  ];

  const fullyFiltered = steps.reduce((acc, step) => step.apply(acc), base);
  if (fullyFiltered.length > 0) return { results: fullyFiltered, relaxed: [] as string[] };

  const relaxed: string[] = [];
  let current = base;
  for (const step of steps) {
    const next = step.apply(current);
    if (next.length === 0) {
      relaxed.push(step.name);
      continue;
    }
    current = next;
  }

  return { results: current.length > 0 ? current : base, relaxed };
}

function sortByBestFit(items: QueueItem[], intent: Intent) {
  const minutes = intent.availableMinutes;
  const target = minutes ?? null;

  return [...items]
    .map((it) => {
      let score = 0;
      if (intent.savedBy && it.savedBy === intent.savedBy) score += 6;
      if (intent.modality && it.modality === intent.modality) score += 5;
      if (intent.topic && matchesTopic(it, intent.topic)) score += 5;
      if (target !== null) {
        const delta = target - it.durationMinutes;
        if (delta >= 0) score += 7 - Math.min(7, Math.floor(delta / 5));
        else score -= 6;
      }
      return { it, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

export default function RecommendPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const unwrappedSearchParams = use(searchParams ?? Promise.resolve<{ q?: string }>({}));
  const q = (unwrappedSearchParams.q ?? "").trim();

  const items = useMemo(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
    } catch {
      return [];
    }
  }, []);

  const intent = useMemo(() => parseIntent(q), [q]);
  const { results, relaxed } = useMemo(() => progressiveResults(items, intent), [items, intent]);
  const sorted = useMemo(() => sortByBestFit(results, intent), [results, intent]);

  const featured = sorted[0] ?? null;
  const rest = sorted.slice(1, 5);

  const header = matchHeader(q, intent);
  const relaxNote = relaxed.length > 0 ? `Relaxed: ${relaxed.join(" → ")}` : null;

  const featuredLabel = useMemo(() => {
    if (intent.availableMinutes !== null) return `Best choice for your ${intent.availableMinutes} minutes`;
    if (intent.modality) return `Best ${MODALITY_LABEL[intent.modality].toLowerCase()} option`;
    return "Top match";
  }, [intent.availableMinutes, intent.modality]);

  return (
    <div className="min-h-dvh">
      <main className="mx-auto w-full max-w-lg px-5 pb-10 pt-10">
        <header className="text-center">
          <div className="text-2xl font-semibold tracking-tight text-foreground">Binge</div>
          <div className="mt-1 text-sm leading-6 text-foreground/60">A few options for right now</div>
        </header>

        <section className="mt-8 rounded-2xl border border-white/10 bg-slate-800 p-4 shadow-[0_22px_76px_rgba(0,0,0,0.60)]">
          <div className="text-xs font-semibold tracking-wide text-foreground/45">YOUR REQUEST</div>
          <div className="mt-2 text-sm font-semibold text-foreground">{header}</div>
          {relaxNote ? <div className="mt-2 text-xs font-semibold text-foreground/40">{relaxNote}</div> : null}
        </section>

        <section className="mt-5 grid gap-3">
          {sorted.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-800 p-5 text-sm text-foreground/60 shadow-[0_22px_70px_rgba(0,0,0,0.55)]">
              Save a few links to your library first, then try again.
            </div>
          ) : null}

          {featured ? (
            <article className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-800 shadow-[0_26px_92px_rgba(0,0,0,0.62)]">
              <Link
                href={`/content/${encodeURIComponent(featured.id)}`}
                onClick={() => cacheForContentPage(featured)}
                className="block"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden">
                  <Image
                    src={featured.thumbnailUrl || thumbFallback(featured)}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 100vw, 512px"
                    className="object-cover"
                    priority
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
                </div>

                <div className="border-t border-white/10 bg-slate-800 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold tracking-wide text-[#2b6cb0]">TOP MATCH</div>
                    <div className="text-xs font-semibold text-foreground/45">{featured.durationMinutes} min</div>
                  </div>

                  <div className="mt-2 text-sm font-semibold text-foreground/80">{featuredLabel}</div>
                  <div className="mt-3 text-lg font-semibold leading-7 text-foreground">{featured.title}</div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${MODALITY_PILL[featured.modality]}`}
                    >
                      {MODALITY_LABEL[featured.modality]}
                    </span>
                    <span className="text-[11px] font-semibold text-foreground/55">Shared by {featured.savedBy}</span>
                  </div>

                  <div className="mt-3 text-xs leading-5 text-foreground/60">{reasoningText(featured, intent)}</div>
                </div>
              </Link>
            </article>
          ) : null}

          {rest.map((item) => (
            <Link
              key={item.id}
              href={`/content/${encodeURIComponent(item.id)}`}
              onClick={() => cacheForContentPage(item)}
              className="block rounded-2xl border border-white/10 bg-slate-800 p-4 shadow-[0_20px_66px_rgba(0,0,0,0.52)] transition duration-200 active:scale-[0.995]"
            >
              <div className="flex items-stretch justify-between gap-4">
                <div className="flex min-w-0 flex-1 gap-3">
                  <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10">
                    <Image
                      src={item.thumbnailUrl || thumbFallback(item)}
                      alt=""
                      fill
                      sizes="112px"
                      className="object-cover"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${MODALITY_PILL[item.modality]}`}
                      >
                        {MODALITY_LABEL[item.modality]}
                      </span>
                      <span className="text-[11px] font-semibold text-foreground/45">Shared by {item.savedBy}</span>
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold leading-6 text-foreground">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-foreground/60">{reasoningText(item, intent)}</div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end justify-between">
                  <span className="inline-flex h-6 items-center justify-center rounded-full bg-white/5 px-3 text-[11px] font-semibold text-white ring-1 ring-white/25">
                    {item.durationMinutes} min
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>

        <div className="mt-7 grid grid-cols-2 gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-foreground/80 shadow-[0_18px_55px_rgba(0,0,0,0.25)] backdrop-blur"
          >
            Back
          </Link>
          <Link
            href="/library"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-foreground ring-1 ring-white/10"
          >
            My Library
          </Link>
        </div>
      </main>
    </div>
  );
}
