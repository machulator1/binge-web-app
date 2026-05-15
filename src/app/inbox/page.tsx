"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { tryNativeShare } from "@/lib/nativeShare";
import { ShareSheet, type ShareSheetData } from "@/components/ShareSheet";

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
};

const SAVED_ITEMS_STORAGE_KEY = "binge_saved_items_v1";

type SavedModality = "article" | "video" | "podcast" | "music";

type SavedQueueItem = {
  id: string;
  title: string;
  url: string;
  modality: SavedModality;
  thumbnailUrl: string;
  durationMinutes: number;
  source: string;
  provider?: string;
  canonicalUrl?: string;
  savedBy: string;
  status: "saved";
  dateSaved: string;
  savedAt?: string;
  description?: string;
  notes?: string;
};

export default function InboxPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [shareSheet, setShareSheet] = useState<ShareSheetData | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "unauthorized" | "failed">(
    "idle",
  );
  const [shares, setShares] = useState<ShareRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!supabase) {
          setSessionEmail(null);
          setStatus("unauthorized");
          return;
        }

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        setSessionEmail(data.session?.user?.email ?? null);

        if (!token) {
          setStatus("unauthorized");
          return;
        }

        setStatus("loading");
        const res = await fetch("/api/shares/inbox", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          if (!cancelled) setStatus(res.status === 401 ? "unauthorized" : "failed");
          return;
        }

        const json = (await res.json()) as { shares?: ShareRow[] };
        const rows = Array.isArray(json.shares) ? json.shares : [];
        if (!cancelled) {
          setShares(rows);
          setStatus("loaded");
        }
      } catch {
        if (!cancelled) setStatus("failed");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function shareOut(row: ShareRow) {
    const shared = await tryNativeShare({
      title: row.title ?? "Shared in Binge",
      text: row.summary ?? undefined,
      url: row.url,
    });
    if (shared) return;
    setShareSheet({
      title: row.title ?? "Shared in Binge",
      text: row.summary ?? undefined,
      url: row.url,
    });
  }

  function saveToLibrary(row: ShareRow) {
    const title = row.title ?? "Shared link";
    const savedAt = new Date().toISOString();
    const item: SavedQueueItem = {
      id: `s_${Date.now().toString(36)}`,
      title,
      url: row.url,
      modality: "article",
      thumbnailUrl: row.thumbnail_url ?? "https://picsum.photos/seed/binge-shared/1200/675",
      durationMinutes: 6,
      source: row.source ?? "Shared",
      savedBy: "Me",
      status: "saved",
      savedAt,
      dateSaved: savedAt.slice(0, 10),
      description: row.summary ?? undefined,
      notes: row.message ?? undefined,
    };

    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const existing = Array.isArray(parsed) ? (parsed as SavedQueueItem[]) : [];
      const next = [item, ...existing].slice(0, 200);
      window.localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }

    router.push("/library");
  }

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-10 pt-11">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-foreground">Inbox</div>
            <div className="mt-1 text-sm font-medium text-foreground/55">
              Shared with you{sessionEmail ? ` • ${sessionEmail}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
            >
              Profile
            </Link>
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
            >
              Home
            </Link>
          </div>
        </header>

        {status === "unauthorized" ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5 text-sm font-semibold text-foreground/70">
            Sign in to see your inbox.
          </div>
        ) : status === "loading" ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5 text-sm font-semibold text-foreground/70">
            Loading…
          </div>
        ) : status === "failed" ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5 text-sm font-semibold text-foreground/70">
            Couldn’t load your inbox.
          </div>
        ) : shares.length === 0 ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5 text-sm font-semibold text-foreground/70">
            Nothing shared with you yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {shares.map((row) => (
              <article
                key={row.id}
                className="overflow-hidden rounded-[28px] border border-white/12 bg-slate-800/95 shadow-[0_24px_86px_rgba(0,0,0,0.56)]"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-black/20">
                  <Image
                    src={row.thumbnail_url ?? "https://picsum.photos/seed/binge-inbox/1200/675"}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 100vw, 512px"
                    className="object-cover"
                  />
                </div>
                <div className="p-4">
                  <div className="line-clamp-2 text-base font-semibold leading-6 text-foreground">
                    {row.title ?? row.url}
                  </div>
                  {row.summary ? (
                    <div className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-foreground/60">
                      {row.summary}
                    </div>
                  ) : null}
                  {row.message ? (
                    <div className="mt-3 line-clamp-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium italic leading-5 text-foreground/55">
                      “{row.message}”
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {row.source ? (
                        <span className="inline-flex h-4 items-center justify-center rounded-full bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                          {row.source}
                        </span>
                      ) : null}
                      <span className="truncate text-xs font-semibold text-foreground/45">{row.url}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => window.open(row.url, "_blank", "noopener,noreferrer")}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-white/12 bg-white/5 px-3 text-xs font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => saveToLibrary(row)}
                        className="inline-flex h-9 items-center justify-center rounded-xl bg-blue-500/90 px-3 text-xs font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30 transition duration-200 active:bg-blue-500"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => void shareOut(row)}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-white/12 bg-white/5 px-3 text-xs font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
                      >
                        Share
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <ShareSheet open={!!shareSheet} data={shareSheet} onClose={() => setShareSheet(null)} />
      </main>
    </div>
  );
}
