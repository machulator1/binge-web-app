"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ShareSheet, type ShareSheetData } from "@/components/ShareSheet";
import { SendToFriendSheet } from "@/components/SendToFriendSheet";
import { tryNativeShare } from "@/lib/nativeShare";
import { savedAtFromDateSaved, savedDateLabel } from "@/lib/savedDate";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { looksLikeUrl } from "@/lib/urlImport";
import { useSaveToBingeFlow } from "@/lib/useSaveToBingeFlow";

type Modality = "article" | "video" | "podcast";
type ItemStatus = "saved" | "in_progress" | "consumed";

type QueueItem = {
  id: string;
  title: string;
  url?: string;
  modality: Modality;
  durationMinutes: number;
  source: string;
  savedBy: string;
  sharedBy?: string;
  status: ItemStatus;
  dateSaved: string; // YYYY-MM-DD
  savedAt?: string;
  thumbnailUrl?: string;
  description?: string;
  shareMessage?: string;
  notes?: string;
  storage?: "local" | "server";
};

type ShareRow = {
  id: string;
  created_at: string;
  from_user_id: string;
  to_user_id: string;
  url: string;
  title: string | null;
  summary: string | null;
  message: string | null;
  thumbnail_url: string | null;
  source: string | null;
  opened_at: string | null;
  fromHandle?: string | null;
};

type BriefStory = {
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  thumbnailUrl?: string;
  readingTimeMinutes: number;
};

const SAVED_ITEMS_STORAGE_KEY = "binge_saved_items_v1";
const DAILY_BRIEF_DISMISSED_STORAGE_KEY = "binge_daily_brief_dismissed_v1";

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

type SendPayload = {
  url: string;
  title: string;
  summary?: string;
  thumbnailUrl?: string;
  source?: string;
};

function withSavedAt(item: QueueItem): QueueItem {
  return { ...item, savedAt: item.savedAt ?? savedAtFromDateSaved(item.dateSaved) };
}

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

function isPlaceholderTitle(raw: string) {
  const v = raw.trim();
  if (!v) return true;
  if (/^A Great\b/i.test(v)) return true;
  if (/\bWorth Saving\b/i.test(v)) return true;
  if (/^A Smart\b/i.test(v)) return true;
  if (/^YouTube\s+video$/i.test(v)) return true;
  return false;
}

function isPlaceholderDescription(raw?: string) {
  const v = (raw ?? "").trim();
  if (!v) return false;
  if (/^A short\b/i.test(v)) return true;
  if (/^A focused\b/i.test(v)) return true;
  if (/^A clean\b/i.test(v)) return true;
  if (/enjoy the videos and music you love/i.test(v)) return true;
  if (/youtube is a/i.test(v) && /video/i.test(v)) return true;
  if (/watch videos/i.test(v) && /youtube/i.test(v)) return true;
  return false;
}

function thumbDataUri(modality: Modality) {
  const accent =
    modality === "video" ? "#8b5cf6" : modality === "podcast" ? "#10b981" : "#3b82f6";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0a0a0a"/>
          <stop offset="0.6" stop-color="#3f3f46"/>
          <stop offset="1" stop-color="${accent}"/>
        </linearGradient>
      </defs>
      <rect width="480" height="270" rx="34" fill="url(#g)"/>
      <circle cx="86" cy="194" r="46" fill="rgba(255,255,255,0.10)"/>
      <path d="M136 166c58 18 96 56 116 116" stroke="rgba(255,255,255,0.22)" stroke-width="20" stroke-linecap="round" fill="none"/>
    </svg>
  `.trim();

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function domainThumbDataUri({ hostname, modality }: { hostname: string; modality: Modality }) {
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

function fallbackThumbForItem(item: QueueItem) {
  if (item.url) {
    try {
      const u = new URL(item.url);
      return domainThumbDataUri({ hostname: u.hostname, modality: item.modality });
    } catch {
      // Ignore
    }
  }
  return thumbDataUri(item.modality);
}

function CardThumb({
  item,
  size,
}: {
  item: QueueItem;
  size: "featured" | "default";
}) {
  const [failed, setFailed] = useState(false);
  const fallback = fallbackThumbForItem(item);
  const src = !failed && item.thumbnailUrl ? item.thumbnailUrl : fallback;

  return (
    <Image
      src={src}
      alt="Thumbnail"
      fill
      sizes={size === "featured" ? "288px" : "224px"}
      className="object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function Row({
  title,
  items,
  size,
  onOpen,
  onShare,
  onSend,
  onDelete,
}: {
  title: string;
  items: QueueItem[];
  size: "featured" | "default";
  onOpen: (item: QueueItem) => void;
  onShare: (item: QueueItem) => void;
  onSend?: (item: QueueItem) => void;
  onDelete?: (item: QueueItem) => void;
}) {
  if (items.length === 0) return null;

  const cardWidth = size === "featured" ? "w-72" : "w-56";
  const thumbHeight = size === "featured" ? "aspect-[16/9]" : "aspect-[16/9]";

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-end justify-between px-5">
        <h2 className="text-lg font-semibold leading-7 tracking-tight text-foreground">{title}</h2>
      </div>

      <div className="relative isolate -my-4 overflow-x-auto overflow-y-visible overscroll-x-contain bg-transparent px-5 py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex snap-x snap-mandatory gap-3 pr-5 scroll-smooth">
          {items.map((item) => {
            const savedLabel = savedDateLabel(item.savedAt ?? savedAtFromDateSaved(item.dateSaved));

            return (
              <article
                key={item.id}
                className={`${cardWidth} snap-start shrink-0 overflow-hidden rounded-[22px] border border-white/12 bg-slate-800/95 shadow-[0_18px_28px_-22px_rgba(0,0,0,0.75)] transition duration-200 active:scale-[0.99]`}
              >
              <div className={`relative ${thumbHeight} w-full overflow-hidden bg-black/20`}>
                <CardThumb item={item} size={size} />
              </div>

              <div className="bg-slate-800/70 p-3">
                <div className="truncate text-sm font-semibold leading-6 text-foreground">
                  {item.title}
                </div>

                {item.description ? (
                  <div className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-foreground/55">
                    {item.description}
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-4 items-center justify-center rounded-full px-2 text-[11px] font-semibold ring-1 ring-inset ${MODALITY_PILL[item.modality]}`}
                    >
                      {MODALITY_LABEL[item.modality]}
                    </span>
                    <span className="inline-flex h-4 items-center justify-center rounded-full bg-white/5 px-2 text-[11px] font-semibold text-white ring-1 ring-white/25">
                      {item.durationMinutes} min
                    </span>
                    {item.sharedBy ? (
                      <span className="truncate text-[11px] font-semibold text-white/60">
                        Shared by {item.sharedBy}
                      </span>
                    ) : null}
                    {savedLabel ? (
                      <span className="truncate text-[11px] font-semibold text-white/45">{savedLabel}</span>
                    ) : null}
                  </div>
                </div>

                {item.shareMessage ? (
                  <div className="mt-3 line-clamp-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium italic leading-5 text-foreground/55">
                    “{item.shareMessage}”
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    disabled={!item.url}
                    className={`inline-flex h-9 flex-1 items-center justify-center rounded-xl px-3 text-xs font-semibold shadow-[0_18px_55px_rgba(0,0,0,0.30)] ring-1 transition duration-200 ${
                      item.url
                        ? "bg-blue-500/90 text-white ring-blue-300/30 active:bg-blue-500"
                        : "bg-white/5 text-foreground/35 ring-white/10"
                    }`}
                  >
                    Open
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onShare(item)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-foreground/80 transition duration-200 hover:bg-white/10 hover:ring-1 hover:ring-white/12 active:scale-[0.98] active:bg-white/12 active:text-foreground"
                      aria-label="Share"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                        <path
                          d="M12 3v10"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M8 6.5 12 3l4 3.5"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M7 10h-.2A2.8 2.8 0 0 0 4 12.8V18a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5.2A2.8 2.8 0 0 0 17.2 10H17"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>

                    {onSend ? (
                      <button
                        type="button"
                        onClick={() => onSend(item)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-foreground/80 transition duration-200 hover:bg-white/10 hover:ring-1 hover:ring-white/12 active:scale-[0.98] active:bg-white/12 active:text-foreground"
                        aria-label="Send to friend"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                          <path
                            d="M3.5 11.5 21 3.5l-8 17-2.5-7L3.5 11.5Z"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M10.5 13.5 21 3.5"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    ) : null}

                    {onDelete ? (
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-foreground/80 transition duration-200 hover:bg-white/10 hover:ring-1 hover:ring-white/12 active:scale-[0.98] active:bg-white/12 active:text-foreground"
                        aria-label="Delete"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-[26px]">
                          <path
                            d="M9 3h6m-8 4h10m-9 0 1 14h6l1-14"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M10 11v6M14 11v6"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const INITIAL_ITEMS: QueueItem[] = [
  {
    id: "q1",
    title: "A practical guide to making time for deep work",
    url: "https://example.com/deep-work-guide",
    modality: "article",
    durationMinutes: 12,
    source: "Farnam Street",
    savedBy: "Me",
    status: "saved",
    dateSaved: "2026-02-12",
    notes: "Try the 2-hour focus block idea.",
  },
  {
    id: "q2",
    title: "The surprisingly efficient way to learn anything",
    url: "https://example.com/learn-anything",
    modality: "video",
    durationMinutes: 9,
    source: "YouTube",
    savedBy: "Ava",
    status: "saved",
    dateSaved: "2026-01-28",
  },
  {
    id: "q3",
    title: "Designing mobile-first interfaces: patterns that scale",
    url: "https://example.com/mobile-first-patterns",
    modality: "article",
    durationMinutes: 18,
    source: "Smashing Magazine",
    savedBy: "Me",
    status: "in_progress",
    dateSaved: "2026-03-04",
    notes: "Skim the navigation section again.",
  },
  {
    id: "q4",
    title: "Why habits beat motivation (and how to build them)",
    url: "https://example.com/habits",
    modality: "podcast",
    durationMinutes: 33,
    source: "The Knowledge Project",
    savedBy: "Jordan",
    status: "saved",
    dateSaved: "2026-01-05",
  },
  {
    id: "q5",
    title: "A 4-minute reset for your neck and shoulders",
    url: "https://example.com/mobility-reset",
    modality: "video",
    durationMinutes: 4,
    source: "YouTube",
    savedBy: "Me",
    status: "saved",
    dateSaved: "2026-03-30",
    notes: "Do this on breaks.",
  },
  {
    id: "q6",
    title: "How to write better prompts (without overthinking)",
    url: "https://example.com/better-prompts",
    modality: "article",
    durationMinutes: 7,
    source: "Latent Space",
    savedBy: "Ava",
    status: "consumed",
    dateSaved: "2026-01-14",
    notes: "Good checklist at the end.",
  },
  {
    id: "q7",
    title: "The 10-minute walk that fixes your day",
    url: "https://example.com/10-minute-walk",
    modality: "podcast",
    durationMinutes: 10,
    source: "Hidden Brain",
    savedBy: "Me",
    status: "saved",
    dateSaved: "2026-02-02",
  },
];

export default function LibraryPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [shareSheet, setShareSheet] = useState<ShareSheetData | null>(null);
  const [sendSheet, setSendSheet] = useState<SendPayload | null>(null);
  const [shareInboxItems, setShareInboxItems] = useState<QueueItem[]>([]);
  const [dailyBriefItems, setDailyBriefItems] = useState<QueueItem[]>([]);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");

  const {
    saveUrl,
    saveDraft,
    setSaveDraft,
    saveFeedback,
    resolveStatus,
    openFromUrl,
    closeSaveFlow,
    saveToLibrary,
  } = useSaveToBingeFlow({ sessionToken });

  useEffect(() => {
    function load() {
      try {
        const raw = window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        const stored = Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
        setItems(stored.map((it) => withSavedAt({ ...it, storage: it.storage ?? "local" })));
      } catch {
        // Ignore
      }
    }

    load();

    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_ITEMS_STORAGE_KEY) load();
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadServerItems() {
      if (!sessionToken) return;

      try {
        const res = await fetch("/api/saved-items", {
          headers: {
            authorization: `Bearer ${sessionToken}`,
          },
        });

        if (!res.ok) return;

        const data = (await res.json()) as { items?: QueueItem[] };
        const loaded = Array.isArray(data.items) ? (data.items as QueueItem[]) : [];
        const next = loaded.map((it) => withSavedAt({ ...it, storage: "server" as const }));
        if (cancelled) return;
        setItems(next);

        try {
          const raw = window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY);
          const parsed = raw ? (JSON.parse(raw) as unknown) : [];
          const stored = Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
          const local = stored.filter((it) => (it.storage ?? "local") !== "server");
          if (local.length === 0) return;

          await Promise.all(
            local.slice(0, 100).map((it) =>
              fetch("/api/saved-items", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({
                  url: it.url,
                  title: it.title,
                  modality: it.modality,
                  thumbnailUrl: it.thumbnailUrl,
                  durationMinutes: it.durationMinutes,
                  source: it.source,
                  savedBy: it.savedBy,
                  status: it.status,
                  savedAt: it.savedAt,
                  dateSaved: it.dateSaved,
                  description: it.description,
                  notes: it.notes,
                }),
              }),
            ),
          );

          const refreshed = await fetch("/api/saved-items", {
            headers: {
              authorization: `Bearer ${sessionToken}`,
            },
          });
          if (!refreshed.ok) return;
          const refreshedData = (await refreshed.json()) as { items?: QueueItem[] };
          const refreshedItems = Array.isArray(refreshedData.items)
            ? (refreshedData.items as QueueItem[])
            : [];
          if (cancelled) return;
          setItems(refreshedItems.map((it) => withSavedAt({ ...it, storage: "server" as const })));
          window.localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify([]));
        } catch {
          // Ignore migration failures
        }
      } catch {
        // Ignore
      }
    }

    void loadServerItems();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!supabase) {
      setSessionToken(null);
      return;
    }

    const sb = supabase;
    let mounted = true;

    async function loadSession() {
      try {
        const { data } = await sb.auth.getSession();
        if (!mounted) return;
        setSessionToken(data.session?.access_token ?? null);
      } catch {
        if (!mounted) return;
        setSessionToken(null);
      }
    }

    void loadSession();

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setSessionToken(session?.access_token ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function repairMetadata() {
      const candidates = items
        .filter((it) => {
          if (!it.url) return false;
          const url = it.url.toLowerCase();
          const isYoutube = url.includes("youtube.com") || url.includes("youtu.be");
          if (!isYoutube) return false;
          const hasDescription = Boolean((it.description ?? "").trim());
          if (!hasDescription) return true;
          if (isPlaceholderTitle(it.title)) return true;
          if (isPlaceholderDescription(it.description)) return true;
          return false;
        })
        .slice(0, 10);

      for (const item of candidates) {
        if (cancelled) return;

        try {
          const res = await fetch("/api/resolve-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: item.url }),
          });
          if (!res.ok) continue;

          const data = (await res.json()) as ResolvedLink;
          const nextTitle = (data.title ?? "").trim();
          const nextDescription = (data.description ?? "").trim();

          const patched: QueueItem = {
            ...item,
            title: nextTitle ? nextTitle : item.title,
            description: nextDescription ? nextDescription : item.description,
            thumbnailUrl: data.image ?? item.thumbnailUrl,
            source: data.source ?? item.source,
            modality: data.modality ?? item.modality,
          };

          if (cancelled) return;

          setItems((prev) => prev.map((it) => (it.id === item.id ? patched : it)));

          if (item.storage === "server" && sessionToken) {
            void fetch("/api/saved-items", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${sessionToken}`,
              },
              body: JSON.stringify({
                url: patched.url,
                title: patched.title,
                modality: patched.modality,
                thumbnailUrl: patched.thumbnailUrl,
                durationMinutes: patched.durationMinutes,
                source: patched.source,
                savedBy: patched.savedBy,
                status: patched.status,
                savedAt: patched.savedAt,
                dateSaved: patched.dateSaved,
                description: patched.description,
                notes: patched.notes,
              }),
            });
          }

          if (item.storage !== "server") {
            try {
              const raw = window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY);
              const parsed = raw ? (JSON.parse(raw) as unknown) : [];
              const stored = Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
              const next = stored.map((it) => (it.id === item.id ? { ...patched, storage: it.storage } : it));
              window.localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(next));
            } catch {
              // Ignore
            }
          }
        } catch {
          // Ignore per-item failures
        }
      }
    }

    void repairMetadata();
    return () => {
      cancelled = true;
    };
  }, [items, sessionToken]);

  useEffect(() => {
    let cancelled = false;

    async function loadInbox() {
      if (!sessionToken) {
        if (!cancelled) setShareInboxItems([]);
        return;
      }

      try {
        const res = await fetch("/api/shares/inbox", {
          headers: {
            authorization: `Bearer ${sessionToken}`,
          },
        });

        if (!res.ok) {
          if (!cancelled) setShareInboxItems([]);
          return;
        }

        const json = (await res.json()) as { shares?: ShareRow[] };
        const shares = Array.isArray(json.shares) ? (json.shares as ShareRow[]) : [];
        const mapped = shares.map((s) => ({
          id: s.id,
          title: s.title ?? "Shared link",
          url: s.url,
          modality: "article" as const,
          durationMinutes: 5,
          source: s.source ?? "Shared",
          savedBy: "Friend",
          sharedBy: s.fromHandle ? `@${s.fromHandle}` : "a friend",
          status: "saved" as const,
          savedAt: s.created_at ?? new Date().toISOString(),
          dateSaved: (s.created_at ?? new Date().toISOString()).slice(0, 10),
          thumbnailUrl: s.thumbnail_url ?? undefined,
          description: s.summary ?? undefined,
          shareMessage: s.message ?? undefined,
        }));

        if (!cancelled) setShareInboxItems(mapped);
      } catch {
        if (!cancelled) setShareInboxItems([]);
      }
    }

    void loadInbox();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  useEffect(() => {
    let cancelled = false;

    async function loadDailyBrief() {
      try {
        const res = await fetch("/api/daily-ai-brief");
        if (!res.ok) {
          if (!cancelled) setDailyBriefItems([]);
          return;
        }

        const json = (await res.json()) as { stories?: BriefStory[] };
        const stories = Array.isArray(json.stories) ? (json.stories as BriefStory[]) : [];

        let dismissed = new Set<string>();
        try {
          const raw = window.localStorage.getItem(DAILY_BRIEF_DISMISSED_STORAGE_KEY);
          const parsed = raw ? (JSON.parse(raw) as unknown) : [];
          const ids = Array.isArray(parsed) ? (parsed as string[]) : [];
          dismissed = new Set(ids.filter((id) => typeof id === "string" && id.trim()));
        } catch {
          // Ignore
        }

        const mapped = stories
          .filter((story) => !dismissed.has(story.id))
          .map((story) => ({
            id: story.id,
            title: story.title,
            url: story.url,
            modality: "article" as const,
            durationMinutes: story.readingTimeMinutes,
            source: story.source,
            savedBy: "Daily Brief",
            status: "saved" as const,
            savedAt: new Date().toISOString(),
            dateSaved: new Date().toISOString().slice(0, 10),
            thumbnailUrl: story.thumbnailUrl,
            description: story.summary,
          }));
        if (!cancelled) setDailyBriefItems(mapped);
      } catch {
        if (!cancelled) setDailyBriefItems([]);
      }
    }

    void loadDailyBrief();
    return () => {
      cancelled = true;
    };
  }, []);

  const videos = useMemo(() => items.filter((it) => it.modality === "video"), [items]);
  const podcasts = useMemo(() => items.filter((it) => it.modality === "podcast"), [items]);
  const articles = useMemo(() => items.filter((it) => it.modality === "article"), [items]);
  const savedByMe = useMemo(() => items.filter((it) => it.savedBy === "Me"), [items]);

  function openInApp(item: QueueItem) {
    if (!item.url) return;
    try {
      window.sessionStorage.setItem(`binge_content_item_${item.id}`, JSON.stringify(item));
    } catch {
      // Ignore
    }
    window.location.href = `/content/${encodeURIComponent(item.id)}`;
  }

  async function shareItem(item: QueueItem) {
    const url = item.url ?? "";
    if (!url) return;

    const shared = await tryNativeShare({
      title: item.title,
      text: item.description ?? item.notes ?? "",
      url,
    });
    if (shared) return;

    setShareSheet({
      title: item.title,
      text: item.description ?? item.notes ?? "",
      url,
    });
  }

  function onImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = importUrl.trim();
    if (!q) return;
    if (!looksLikeUrl(q)) return;
    setImportUrl("");
    openFromUrl(q);
  }

  function onImportPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").trim();
    if (!looksLikeUrl(pasted)) return;
    e.preventDefault();
    setImportUrl("");
    openFromUrl(pasted);
  }

  async function saveToLibraryAndRefresh() {
    const result = await saveToLibrary();
    const localItem = result.localItem as
      | {
          id: string;
          title: string;
          url: string;
          modality: Modality;
          durationMinutes: number;
          source: string;
          savedBy: string;
          status: ItemStatus;
          savedAt?: string;
          dateSaved: string;
          thumbnailUrl?: string;
          description?: string;
          notes?: string;
        }
      | null;

    if (localItem) {
      setItems((prev) => {
        const storage = sessionToken ? ("server" as const) : ("local" as const);
        const nextItem: QueueItem = { ...localItem, storage };
        const next = [nextItem, ...prev.filter((it) => it.url !== nextItem.url)];
        return next;
      });
    }

    window.setTimeout(() => {
      closeSaveFlow();
    }, 1200);
  }

  function sendToFriend(item: QueueItem) {
    if (!sessionToken) return;
    const url = item.url ?? "";
    if (!url) return;
    setSendSheet({
      url,
      title: item.title,
      summary: item.description,
      thumbnailUrl: item.thumbnailUrl,
      source: item.source,
    });
  }

  function deleteItem(item: QueueItem) {
    if (!confirm("Delete this item from your library?")) return;

    if (sessionToken && item.storage === "server") {
      const next = items.filter((it) => it.id !== item.id);
      setItems(next);

      void fetch(`/api/saved-items?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
      });

      return;
    }

    try {
      const next = items.filter((it) => it.id !== item.id);
      setItems(next);
      window.localStorage.setItem(
        SAVED_ITEMS_STORAGE_KEY,
        JSON.stringify(next.map((it) => ({ ...it, storage: it.storage ?? "local" }))),
      );
    } catch {
      // Ignore
    }
  }

  function deleteDailyBriefItem(item: QueueItem) {
    if (!confirm("Remove this story from Daily AI Brief?")) return;
    setDailyBriefItems((prev) => prev.filter((it) => it.id !== item.id));

    try {
      const raw = window.localStorage.getItem(DAILY_BRIEF_DISMISSED_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const ids = Array.isArray(parsed) ? (parsed as string[]) : [];
      const next = Array.from(new Set([...ids, item.id])).slice(-500);
      window.localStorage.setItem(DAILY_BRIEF_DISMISSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }

  function deleteSharedInboxItem(item: QueueItem) {
    if (!sessionToken) return;
    if (!confirm("Remove this shared item?")) return;
    setShareInboxItems((prev) => prev.filter((it) => it.id !== item.id));

    void fetch(`/api/shares/inbox?id=${encodeURIComponent(item.id)}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
  }

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-5 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold tracking-tight text-foreground">My Library</div>
            </div>

            <Link
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg pb-10 pt-[60px]">
        <section className="px-5 pt-4">
          <form onSubmit={onImportSubmit}>
            <div className="relative">
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                onPaste={onImportPaste}
                placeholder="Paste URL to add"
                className="h-11 w-full rounded-2xl border border-white/12 bg-white/5 px-4 text-sm font-semibold text-foreground/85 shadow-[0_14px_55px_rgba(0,0,0,0.22)] outline-none placeholder:text-foreground/35 focus:border-white/18"
                enterKeyHint="done"
              />
            </div>
          </form>
        </section>

        <Row title="Videos" items={videos} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
        <Row title="Podcasts" items={podcasts} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
        <Row title="Articles" items={articles} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
        <Row
          title="Shared by friends"
          items={shareInboxItems}
          size="default"
          onOpen={openInApp}
          onShare={shareItem}
          onSend={sessionToken ? sendToFriend : undefined}
          onDelete={deleteSharedInboxItem}
        />
        <Row
          title="Daily AI Brief"
          items={dailyBriefItems}
          size="default"
          onOpen={openInApp}
          onShare={shareItem}
          onSend={sessionToken ? sendToFriend : undefined}
          onDelete={deleteDailyBriefItem}
        />
        <Row title="Saved by me" items={savedByMe} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
      </main>

      {saveDraft ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            onClick={closeSaveFlow}
            className="absolute inset-0 bg-black/70"
          />

          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg px-4 pb-5">
            <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-slate-900 shadow-[0_30px_120px_rgba(0,0,0,0.75)]">
              <div className="flex items-center justify-between px-5 pb-3 pt-5">
                <div>
                  <div className="text-sm font-semibold tracking-wide text-foreground/70">Save to Binge</div>
                  <div className="mt-1 text-xs font-medium text-foreground/45">{saveUrl}</div>
                </div>
                <button
                  type="button"
                  onClick={closeSaveFlow}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/70"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                    <path
                      d="M6 6l12 12M18 6 6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="px-5 pb-5">
                <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
                  <div className="relative h-44 w-full">
                    <Image
                      src={saveDraft.thumbnailUrl}
                      alt="Saved content thumbnail"
                      fill
                      sizes="(max-width: 1024px) 100vw, 512px"
                      className="object-cover"
                      priority
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-lg font-semibold leading-7 text-foreground">{saveDraft.title}</div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground/60">
                    <span className="inline-flex h-5 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2">
                      {saveDraft.modality === "video"
                        ? "Video"
                        : saveDraft.modality === "podcast"
                          ? "Podcast"
                          : "Article"}
                    </span>
                    <span className="text-foreground/35">•</span>
                    <span className="inline-flex h-5 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2">
                      {saveDraft.durationMinutes} min
                    </span>
                    <span className="text-foreground/35">•</span>
                    <span className="truncate">{saveDraft.source}</span>
                  </div>

                  {resolveStatus === "loading" ? (
                    <div className="mt-2 text-xs font-semibold text-foreground/40">Fetching details…</div>
                  ) : resolveStatus === "failed" ? (
                    <div className="mt-2 text-xs font-semibold text-foreground/40">
                      Couldn’t fetch details — saving with a quick preview.
                    </div>
                  ) : null}

                  {saveDraft.description ? (
                    <div className="mt-2 line-clamp-1 text-sm font-medium text-foreground/55">
                      {saveDraft.description}
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] font-semibold tracking-wide text-foreground/45">Duration (minutes)</div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={saveDraft.durationMinutes}
                        onChange={(e) =>
                          setSaveDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  durationMinutes: Math.max(1, Number(e.target.value) || 1),
                                }
                              : prev,
                          )
                        }
                        className="h-10 w-28 rounded-full border border-white/10 bg-black/10 px-3 text-sm font-semibold text-foreground outline-none focus:border-white/18"
                        aria-label="Duration in minutes"
                      />
                      <div className="text-xs font-semibold text-foreground/40">min</div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] font-semibold tracking-wide text-foreground/45">Shared by</div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSaveDraft((prev) => (prev ? { ...prev, savedBy: "Me" } : prev))}
                        className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-sm font-semibold transition duration-200 ${
                          saveDraft.savedBy.trim().toLowerCase() === "me"
                            ? "border-white/18 bg-white/10 text-foreground"
                            : "border-white/10 bg-white/5 text-foreground/75 hover:bg-white/10"
                        }`}
                      >
                        Me
                      </button>
                      <div className="flex min-w-[160px] flex-1 items-center">
                        <input
                          value={saveDraft.savedBy}
                          onChange={(e) =>
                            setSaveDraft((prev) => (prev ? { ...prev, savedBy: e.target.value } : prev))
                          }
                          className="h-9 w-full rounded-full border border-white/10 bg-black/10 px-3 text-sm font-semibold text-foreground outline-none placeholder:text-foreground/35 focus:border-white/18"
                          placeholder="Friend’s name"
                        />
                      </div>
                    </div>
                  </div>

                  <label className="mt-3 block">
                    <div className="sr-only">Notes</div>
                    <input
                      value={saveDraft.notes}
                      onChange={(e) =>
                        setSaveDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))
                      }
                      className="h-11 w-full rounded-2xl border border-white/12 bg-white/5 px-4 text-sm font-medium text-foreground/80 outline-none placeholder:text-foreground/35 focus:border-white/18"
                      placeholder="Add a note (optional)"
                    />
                  </label>

                  <div className="mt-5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={saveToLibraryAndRefresh}
                      disabled={saveFeedback === "saved"}
                      className={`inline-flex h-12 flex-1 items-center justify-center rounded-2xl text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30 transition duration-200 active:scale-[0.99] disabled:opacity-90 ${
                        saveFeedback === "saved"
                          ? "bg-emerald-500/85 ring-emerald-300/30"
                          : "bg-blue-500/90"
                      }`}
                    >
                      {saveFeedback === "saved" ? "Saved" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={closeSaveFlow}
                      disabled={saveFeedback === "saved"}
                      className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-sm font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-8 mx-auto w-full max-w-md px-4 transition duration-200 ${
                    saveFeedback === "saved" ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                  }`}
                >
                  <div className="rounded-2xl border border-white/12 bg-slate-900/95 px-4 py-3 text-center text-sm font-semibold text-foreground shadow-[0_22px_70px_rgba(0,0,0,0.65)]">
                    Saved to your library
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ShareSheet open={Boolean(shareSheet)} data={shareSheet} onClose={() => setShareSheet(null)} />
      <SendToFriendSheet open={Boolean(sendSheet)} payload={sendSheet} onClose={() => setSendSheet(null)} />
    </div>
  );
}
