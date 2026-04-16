"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ShareSheet, type ShareSheetData } from "@/components/ShareSheet";
import { tryNativeShare } from "@/lib/nativeShare";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type Modality = "article" | "video" | "podcast";

type SavedQueueItem = {
  id: string;
  title: string;
  url: string;
  modality: Modality;
  thumbnailUrl: string;
  durationMinutes: number;
  source: string;
  provider?: string;
  canonicalUrl?: string;
  savedBy: string;
  status: "saved";
  dateSaved: string;
  description?: string;
  notes?: string;
  storage?: "local" | "server";
};

const SAVED_ITEMS_STORAGE_KEY = "binge_saved_items_v1";

function youTubeIdFromUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (host.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      const embedIdx = parts.indexOf("embed");
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    }

    return null;
  } catch {
    return null;
  }
}

export default function ContentPage({ params }: { params: { id: string } }) {
  const unwrappedParams = use(params as unknown as Promise<{ id: string }>);
  const id = decodeURIComponent(unwrappedParams.id);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const item = useMemo(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const stored = Array.isArray(parsed) ? (parsed as SavedQueueItem[]) : [];
      const found = stored.find((it) => it.id === id);
      if (found) return found;
    } catch {
      // Ignore
    }

    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(`binge_content_item_${id}`) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SavedQueueItem;
      if (parsed && parsed.id === id) return parsed;
    } catch {
      // Ignore
    }

    return null;
  }, [id]);

  const youTubeId = useMemo(() => (item ? youTubeIdFromUrl(item.url) : null), [item]);
  const canEmbedYouTube = Boolean(youTubeId);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [shareSheet, setShareSheet] = useState<ShareSheetData | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  async function shareItem() {
    if (!item) return;
    const shared = await tryNativeShare({
      title: item.title,
      text: item.description ?? item.notes ?? "",
      url: item.url,
    });
    if (shared) return;

    setShareSheet({
      title: item.title,
      text: item.description ?? item.notes ?? "",
      url: item.url,
    });
  }

  async function confirmDelete() {
    if (!item) return;

    if (item.storage === "server") {
      try {
        const sessionRes = await supabase?.auth.getSession();
        const token = sessionRes?.data?.session?.access_token;
        if (token) {
          await fetch(`/api/saved-items?id=${encodeURIComponent(item.id)}`,
            {
              method: "DELETE",
              headers: {
                authorization: `Bearer ${token}`,
              },
            },
          );
        }
      } catch {
        // Ignore
      }

      setConfirmDeleteOpen(false);
      window.location.href = "/library";
      return;
    }

    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const existing = Array.isArray(parsed) ? (parsed as SavedQueueItem[]) : [];
      const next = existing.filter((it) => it.id !== item.id);
      window.localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }

    setConfirmDeleteOpen(false);
    window.location.href = "/library";
  }

  if (!mounted) {
    return (
      <div className="min-h-dvh">
        <main className="mx-auto w-full max-w-lg px-5 pb-12 pt-10">
          <div className="rounded-2xl border border-white/10 bg-slate-800 p-5 text-sm text-foreground/60 shadow-[0_22px_76px_rgba(0,0,0,0.60)]">
            Loading…
          </div>
        </main>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-dvh">
        <main className="mx-auto w-full max-w-lg px-5 pb-12 pt-10">
          <div className="rounded-2xl border border-white/10 bg-slate-800 p-5 text-sm text-foreground/60 shadow-[0_22px_76px_rgba(0,0,0,0.60)]">
            This item isn’t available. Go back to your library.
          </div>
          <div className="mt-5">
            <Link
              href="/library"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-foreground/80"
            >
              Back to My Library
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <main className="mx-auto w-full max-w-lg pb-12 pt-8">
        <div className="px-5">
          <Link href="/" className="text-sm font-semibold text-foreground/70">
            Home
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-[28px] border border-white/10 bg-slate-800 shadow-[0_26px_92px_rgba(0,0,0,0.62)]">
          <div className="relative">
            {canEmbedYouTube ? (
              <div className="relative aspect-video w-full overflow-hidden bg-black">
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src={`https://www.youtube.com/embed/${youTubeId}?modestbranding=1&rel=0`}
                  title={item.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="relative aspect-video w-full">
                <Image
                  src={item.thumbnailUrl}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 512px"
                  className="object-cover"
                  priority
                />
              </div>
            )}
          </div>

          <div className="px-5 pb-5 pt-5">
            <div className="text-lg font-semibold leading-7 text-foreground">{item.title}</div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground/60">
              <span className="inline-flex h-5 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2">
                {item.modality === "video" ? "Video" : item.modality === "podcast" ? "Podcast" : "Article"}
              </span>
              <span className="inline-flex h-5 items-center justify-center rounded-full border border-white/10 bg-white/5 px-2">
                {item.durationMinutes} min
              </span>
              <span className="truncate">{item.source}</span>
              <span className="truncate">Shared by {item.savedBy}</span>
            </div>

            {item.description ? (
              <div className="mt-3 text-sm leading-6 text-foreground/70">{item.description}</div>
            ) : null}

            <div className="mt-5 flex items-center gap-3">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl bg-blue-500/90 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30"
              >
                Open original
              </a>
              <button
                type="button"
                onClick={() => void shareItem()}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-foreground/80"
              >
                Share
              </button>
            </div>

            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-rose-200/90"
            >
              Delete
            </button>
          </div>
        </div>
      </main>

      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setConfirmDeleteOpen(false)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg px-4 pb-5">
            <div className="overflow-hidden rounded-[28px] border border-white/12 bg-slate-900 shadow-[0_30px_120px_rgba(0,0,0,0.75)]">
              <div className="px-5 pb-5 pt-5">
                <div className="text-base font-semibold tracking-tight text-foreground">
                  Remove this from your library?
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-medium text-foreground/55">
                  {item.title}
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={confirmDelete}
                    className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-rose-500/90 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-rose-300/30 transition duration-200 active:scale-[0.99]"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteOpen(false)}
                    className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-sm font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ShareSheet open={Boolean(shareSheet)} data={shareSheet} onClose={() => setShareSheet(null)} />
    </div>
  );
}
