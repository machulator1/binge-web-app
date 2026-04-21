"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ShareSheet, type ShareSheetData } from "@/components/ShareSheet";
import { SendToFriendSheet } from "@/components/SendToFriendSheet";
import { tryNativeShare } from "@/lib/nativeShare";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

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
  status: ItemStatus;
  dateSaved: string; // YYYY-MM-DD
  thumbnailUrl?: string;
  description?: string;
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
  thumbnail_url: string | null;
  source: string | null;
  opened_at: string | null;
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
          {items.map((item) => (
            <article
              key={item.id}
              className={`${cardWidth} snap-start shrink-0 overflow-hidden rounded-[22px] border border-white/12 bg-slate-800/95 shadow-[0_18px_28px_-22px_rgba(0,0,0,0.75)] transition duration-200 active:scale-[0.99]`}
            >
              <div className={`relative ${thumbHeight} w-full overflow-hidden bg-black/20`}>
                <Image
                  src={item.thumbnailUrl ?? thumbDataUri(item.modality)}
                  alt="Thumbnail"
                  fill
                  sizes={size === "featured" ? "288px" : "224px"}
                  className="object-cover"
                />
              </div>

              <div className="bg-slate-800/70 p-3">
                <div className="truncate text-sm font-semibold leading-6 text-foreground">
                  {item.title}
                </div>

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
                  </div>
                </div>

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
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                          <path
                            d="M9 3h6m-8 4h10m-9 0 1 14h6l1-14"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M10 11v6M14 11v6"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
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

  useEffect(() => {
    function load() {
      try {
        const raw = window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        const stored = Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
        setItems(stored.map((it) => ({ ...it, storage: it.storage ?? "local" })));
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
        const next = loaded.map((it) => ({ ...it, storage: "server" as const }));
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
          setItems(refreshedItems.map((it) => ({ ...it, storage: "server" as const })));
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

        const data = (await res.json()) as { shares?: ShareRow[] };
        const shares = Array.isArray(data.shares) ? data.shares : [];
        const mapped: QueueItem[] = shares.map((s) => ({
          id: `share_${s.id}`,
          title: s.title ?? s.url,
          url: s.url,
          modality: "article",
          durationMinutes: 5,
          source: s.source ?? "Shared",
          savedBy: "Friend",
          status: "saved",
          dateSaved: (s.created_at ?? new Date().toISOString()).slice(0, 10),
          thumbnailUrl: s.thumbnail_url ?? undefined,
          description: s.summary ?? undefined,
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

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/80 backdrop-blur">
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

      <main className="mx-auto w-full max-w-lg pb-10">
        <Row title="Videos" items={videos} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
        <Row title="Podcasts" items={podcasts} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
        <Row title="Articles" items={articles} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} onDelete={deleteItem} />
        <Row title="Shared by friends" items={shareInboxItems} size="default" onOpen={openInApp} onShare={shareItem} onSend={sessionToken ? sendToFriend : undefined} />
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

      <ShareSheet open={Boolean(shareSheet)} data={shareSheet} onClose={() => setShareSheet(null)} />
      <SendToFriendSheet open={Boolean(sendSheet)} payload={sendSheet} onClose={() => setSendSheet(null)} />
    </div>
  );
}
