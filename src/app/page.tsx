"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShareSheet, type ShareSheetData } from "@/components/ShareSheet";
import { tryNativeShare } from "@/lib/nativeShare";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { SendToFriendSheet } from "@/components/SendToFriendSheet";

type SpeechRecognitionAlternative = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructorAlternative = new () => SpeechRecognitionAlternative;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorAlternative;
    webkitSpeechRecognition?: SpeechRecognitionConstructorAlternative;
  }
}

type SavedModality = "article" | "video" | "podcast";

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
  description?: string;
  notes?: string;
};

const SAVED_ITEMS_STORAGE_KEY = "binge_saved_items_v1";
const LAST_AUTH_EMAIL_STORAGE_KEY = "binge_last_auth_email_v1";

type HomeRecommendation = {
  id: string;
  title: string;
  url: string;
  modality: SavedModality;
  durationMinutes: number;
  sharedBy?: string;
  description: string;
  why: string;
  source: string;
  thumbnailUrl: string;
};

type SendPayload = {
  url: string;
  title: string;
  summary?: string;
  thumbnailUrl?: string;
  source?: string;
};

type ResolvedLink = {
  url: string;
  title: string;
  description?: string;
  image?: string;
  source?: string;
  modality: SavedModality;
  durationMinutes?: number;
  provider?: string;
  canonicalUrl?: string;
};

function looksLikeUrl(value: string) {
  const v = value.trim();
  if (!v) return false;

  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    if (/^[\w-]+\.[\w.-]+(\/|$)/i.test(v)) return true;
    return false;
  }
}

function normalizeUrl(value: string) {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function hostLabel(hostname: string) {
  const parts = hostname.split(".").filter(Boolean);
  const core = parts.length >= 2 ? parts[parts.length - 2] : hostname;
  return core
    .split(/[-_]/g)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function modalityFromUrl(url: URL): SavedModality {
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

function mockTitle(modality: SavedModality, source: string) {
  if (modality === "video") return `A Great ${source} Watch (Worth Saving)`;
  if (modality === "podcast") return `${source}: A Short Episode for Later`;
  return `A Smart ${source} Read for Later`;
}

function mockDuration(modality: SavedModality) {
  if (modality === "video") return 8 + Math.floor(Math.random() * 22);
  if (modality === "podcast") return 12 + Math.floor(Math.random() * 35);
  return 6 + Math.floor(Math.random() * 14);
}

function mockDescription(modality: SavedModality, source: string) {
  if (modality === "video") return `A short ${source} video that’s easy to pick up later.`;
  if (modality === "podcast") return `A focused ${source} episode — perfect for a quick listen.`;
  return `A clean ${source} read worth saving for a calmer moment.`;
}

function buildMockSavedItem(rawUrl: string): Omit<SavedQueueItem, "id" | "savedBy" | "notes"> {
  const url = new URL(normalizeUrl(rawUrl));
  const modality = modalityFromUrl(url);
  const source = hostLabel(url.hostname);
  const title = mockTitle(modality, source);
  const durationMinutes = mockDuration(modality);
  const description = mockDescription(modality, source);
  const thumbnailUrl = `https://picsum.photos/seed/${encodeURIComponent(url.hostname + url.pathname)}/960/540`;
  const dateSaved = new Date().toISOString().slice(0, 10);

  return {
    title,
    url: url.toString(),
    modality,
    thumbnailUrl,
    durationMinutes,
    source,
    status: "saved",
    dateSaved,
    description,
  };
}

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [shareSheet, setShareSheet] = useState<ShareSheetData | null>(null);

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authCooldownUntilMs, setAuthCooldownUntilMs] = useState<number>(0);
  const [authNowMs, setAuthNowMs] = useState<number>(() => Date.now());

  const [sendSheet, setSendSheet] = useState<SendPayload | null>(null);

  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionAlternative | null>(null);

  const [saveUrl, setSaveUrl] = useState<string | null>(null);
  const [saveDraft, setSaveDraft] = useState<
    (Omit<SavedQueueItem, "id" | "savedBy" | "notes"> & { savedBy: string; notes: string }) | null
  >(null);
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saved">("idle");
  const [resolveStatus, setResolveStatus] = useState<"idle" | "loading" | "resolved" | "failed">(
    "idle",
  );

  const prompt = useMemo(() => {
    const q = query.trim();
    if (!q) return "What do you want to watch, read, or listen to?";
    return q;
  }, [query]);

  useEffect(() => {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
        : undefined;

    if (!SpeechRecognitionCtor) {
      setSpeechSupported(false);
      recognitionRef.current = null;
      return;
    }

    setSpeechSupported(true);
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: unknown) => {
      const e = event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> };
      const result = e.results?.[0]?.[0]?.transcript ?? "";
      const text = result.trim();
      if (text) setQuery(text);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.onresult = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    if (!supabase) {
      setSessionEmail(null);
      return;
    }

    const sb = supabase;

    async function loadSession() {
      try {
        const { data } = await sb.auth.getSession();
        if (!mounted) return;
        setSessionEmail(data.session?.user?.email ?? null);
        setSessionToken(data.session?.access_token ?? null);
      } catch {
        if (!mounted) return;
        setSessionEmail(null);
        setSessionToken(null);
      }
    }

    void loadSession();

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email ?? null);
      setSessionToken(session?.access_token ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!authOpen) return;
    if (authEmail.trim()) return;

    try {
      const raw = window.localStorage.getItem(LAST_AUTH_EMAIL_STORAGE_KEY);
      const saved = (raw ?? "").trim();
      if (saved) setAuthEmail(saved);
    } catch {
      // Ignore
    }
  }, [authOpen, authEmail]);

  useEffect(() => {
    if (!authOpen) return;
    const t = window.setInterval(() => setAuthNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [authOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  async function sendMagicLink() {
    if (!supabase) {
      setAuthStatus("failed");
      setAuthError("Supabase auth is not configured.");
      return;
    }

    const email = authEmail.trim();
    if (!email) return;

    if (Date.now() < authCooldownUntilMs) return;

    try {
      setAuthStatus("sending");
      setAuthError(null);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
        },
      });

      if (error) {
        console.error("Supabase signInWithOtp failed:", error);
        setAuthStatus("failed");
        setAuthError(error.message);
        return;
      }

      setAuthCooldownUntilMs(Date.now() + 60_000);

      try {
        window.localStorage.setItem(LAST_AUTH_EMAIL_STORAGE_KEY, email);
      } catch {
        // Ignore
      }

      setAuthStatus("sent");
    } catch (err) {
      console.error("Supabase signInWithOtp threw:", err);
      setAuthStatus("failed");
      setAuthError("Unexpected error while sending link.");
    }
  }

  async function signOut() {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore
    }
  }

  const recommendationThumbSrc = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="512" height="288" viewBox="0 0 512 288">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0a0a0a"/>
            <stop offset="0.55" stop-color="#3f3f46"/>
            <stop offset="1" stop-color="#6366f1"/>
          </linearGradient>
        </defs>
        <rect width="512" height="288" rx="72" fill="url(#g)"/>
        <g fill="rgba(255,255,255,0.92)">
          <circle cx="332" cy="392" r="108" fill="rgba(255,255,255,0.14)"/>
          <path d="M416 332c112 34 186 110 224 224" stroke="rgba(255,255,255,0.28)" stroke-width="54" stroke-linecap="round" fill="none"/>
          <path d="M332 220c138 62 238 164 302 302" stroke="rgba(255,255,255,0.18)" stroke-width="54" stroke-linecap="round" fill="none"/>
        </g>
      </svg>
    `.trim();
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, []);

  const [todaysRecommendation, setTodaysRecommendation] = useState<HomeRecommendation | null>(null);

  const todaysRecommendationTitle = useMemo(() => {
    const raw = (todaysRecommendation?.title ?? "").trim();
    const url = (todaysRecommendation?.url ?? "").trim();
    if (!raw) return "";
    if (url && raw === url) return "";
    if (/^A Great\b/i.test(raw)) return "";
    if (/\bWorth Saving\b/i.test(raw)) return "";
    if (/^A Smart\b/i.test(raw)) return "";
    if (/^A clean\b/i.test(raw)) return "";
    return raw;
  }, [todaysRecommendation?.title, todaysRecommendation?.url]);

  const todaysRecommendationDescription = useMemo(() => {
    const raw = (todaysRecommendation?.description ?? "").trim();
    if (!raw) return "";
    if (/^A short\b/i.test(raw)) return "";
    if (/^A focused\b/i.test(raw)) return "";
    if (/^A clean\b/i.test(raw)) return "";
    return raw;
  }, [todaysRecommendation?.description]);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestSavedFromServer() {
      if (!sessionToken) {
        if (!cancelled) setTodaysRecommendation(null);
        return;
      }

      try {
        const res = await fetch("/api/saved-items", {
          headers: {
            authorization: `Bearer ${sessionToken}`,
          },
          cache: "no-store",
        });

        if (!res.ok) {
          if (!cancelled) setTodaysRecommendation(null);
          return;
        }

        const data = (await res.json()) as {
          items?: Array<{
            id: string;
            title: string;
            url: string;
            modality: SavedModality;
            thumbnailUrl?: string;
            durationMinutes: number;
            source: string;
            savedBy: string;
            description?: string;
          }>;
        };

        const items = Array.isArray(data.items) ? data.items : [];
        const latest = items[0];
        if (!latest?.id || !latest.url) {
          if (!cancelled) setTodaysRecommendation(null);
          return;
        }

        if (!cancelled) {
          setTodaysRecommendation({
            id: latest.id,
            title: latest.title,
            url: latest.url,
            modality: latest.modality,
            durationMinutes: latest.durationMinutes,
            sharedBy: latest.savedBy,
            description: latest.description ?? "",
            why: "Latest item you saved to your library.",
            source: latest.source,
            thumbnailUrl: latest.thumbnailUrl ?? recommendationThumbSrc,
          });
        }
      } catch {
        if (!cancelled) setTodaysRecommendation(null);
      }
    }

    void loadLatestSavedFromServer();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, recommendationThumbSrc]);

  function openTodaysRecommendationInApp({ navigate }: { navigate: boolean } = { navigate: true }) {
    if (!todaysRecommendation) return;
    try {
      const payload = {
        id: todaysRecommendation.id,
        title: todaysRecommendation.title,
        url: todaysRecommendation.url,
        modality: todaysRecommendation.modality,
        thumbnailUrl: todaysRecommendation.thumbnailUrl,
        durationMinutes: todaysRecommendation.durationMinutes,
        source: todaysRecommendation.source,
        savedBy: todaysRecommendation.sharedBy || "Me",
        status: "saved" as const,
        dateSaved: new Date().toISOString().slice(0, 10),
        description: todaysRecommendation.description,
        notes: undefined,
      };
      window.sessionStorage.setItem(
        `binge_content_item_${todaysRecommendation.id}`,
        JSON.stringify(payload),
      );
    } catch {
      // Ignore
    }

    if (navigate) {
      router.push(`/content/${encodeURIComponent(todaysRecommendation.id)}`);
    }
  }

  async function shareRecommendation() {
    if (!todaysRecommendation) return;
    const url = todaysRecommendation.url;
    const text = `${todaysRecommendation.title}\n${url}`;

    const shared = await tryNativeShare({
      title: todaysRecommendation.title,
      text: todaysRecommendation.description,
      url,
    });
    if (shared) return;

    setShareSheet({
      title: todaysRecommendation.title,
      text: todaysRecommendation.description,
      url,
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    if (looksLikeUrl(q)) {
      const normalized = normalizeUrl(q);
      setQuery("");
      const base = buildMockSavedItem(normalized);
      setSaveUrl(base.url);
      setSaveDraft({ ...base, savedBy: "Me", notes: "" });
      void resolveLink(base.url);
      return;
    }

    router.push(`/recommend?q=${encodeURIComponent(q)}`);
  }

  function goToTimeShortcut(minutes: number) {
    router.push(`/recommend?q=${encodeURIComponent(`under ${minutes} minutes`)}`);
  }

  function goToPromptShortcut(value: string) {
    router.push(`/recommend?q=${encodeURIComponent(value)}`);
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").trim();
    if (!looksLikeUrl(pasted)) return;
    e.preventDefault();

    const normalized = normalizeUrl(pasted);
    setQuery("");
    const base = buildMockSavedItem(normalized);
    setSaveUrl(base.url);
    setSaveDraft({ ...base, savedBy: "Me", notes: "" });
    void resolveLink(base.url);
  }

  function closeSaveFlow() {
    setSaveUrl(null);
    setSaveDraft(null);
    setSaveFeedback("idle");
    setResolveStatus("idle");
  }

  async function saveToLibrary() {
    if (!saveDraft) return;

    const item: SavedQueueItem = {
      id: `u_${Date.now().toString(36)}`,
      title: saveDraft.title,
      url: saveDraft.url,
      modality: saveDraft.modality,
      thumbnailUrl: saveDraft.thumbnailUrl,
      durationMinutes: saveDraft.durationMinutes,
      source: saveDraft.source,
      savedBy: saveDraft.savedBy.trim() ? saveDraft.savedBy.trim() : "Me",
      status: "saved",
      dateSaved: saveDraft.dateSaved,
      description: saveDraft.description,
      notes: saveDraft.notes.trim() ? saveDraft.notes.trim() : undefined,
    };

    try {
      const sessionRes = await supabase?.auth.getSession();
      const token = sessionRes?.data?.session?.access_token;
      if (token) {
        const res = await fetch("/api/saved-items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            url: item.url,
            title: item.title,
            modality: item.modality,
            thumbnailUrl: item.thumbnailUrl,
            durationMinutes: item.durationMinutes,
            source: item.source,
            savedBy: item.savedBy,
            status: item.status,
            dateSaved: item.dateSaved,
            description: item.description,
            notes: item.notes,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as { item?: { id: string; title: string; url: string; modality: SavedModality; thumbnailUrl?: string; durationMinutes: number; source: string; savedBy: string; description?: string } };
          const saved = data.item;
          if (saved?.id && saved.url) {
            setTodaysRecommendation({
              id: saved.id,
              title: saved.title,
              url: saved.url,
              modality: saved.modality,
              durationMinutes: saved.durationMinutes,
              sharedBy: saved.savedBy,
              description: saved.description ?? "",
              why: "Latest item you saved to your library.",
              source: saved.source,
              thumbnailUrl: saved.thumbnailUrl ?? item.thumbnailUrl,
            });
          }
        }
      }
    } catch {
      // Ignore server persistence failures
    }

    try {
      const raw =
        typeof window !== "undefined" ? window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const existing = Array.isArray(parsed) ? (parsed as SavedQueueItem[]) : [];
      const next = [item, ...existing].slice(0, 200);
      window.localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }

    setSaveFeedback("saved");
    window.setTimeout(() => {
      setQuery("");
      closeSaveFlow();
      router.push("/library");
    }, 1200);
  }

  async function resolveLink(url: string) {
    try {
      setResolveStatus("loading");
      const res = await fetch("/api/resolve-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        setResolveStatus("failed");
        return;
      }

      const data = (await res.json()) as ResolvedLink;

      setSaveDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title: data.title || prev.title,
          description: data.description ?? prev.description,
          modality: data.modality || prev.modality,
          durationMinutes: data.durationMinutes ?? prev.durationMinutes,
          source: data.source ?? prev.source,
          provider: data.provider ?? prev.provider,
          canonicalUrl: data.canonicalUrl ?? prev.canonicalUrl,
          url: data.canonicalUrl ?? data.url ?? prev.url,
          thumbnailUrl: data.image ?? prev.thumbnailUrl,
        };
      });

      setSaveUrl((prev) => data.canonicalUrl ?? data.url ?? prev);
      setResolveStatus("resolved");
    } catch {
      setResolveStatus("failed");
    }
  }

  function toggleVoiceInput() {
    if (!speechSupported) return;
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening) {
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
      setIsListening(false);
      return;
    }

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold tracking-[-0.04em] text-foreground/90">BINGE</div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/85 shadow-[0_18px_65px_rgba(0,0,0,0.45)] transition duration-200 hover:bg-white/10 active:bg-white/12"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                  <path
                    d="M5 7h14M5 12h14M5 17h14"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {menuOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div className="absolute right-0 top-12 z-50 w-52 overflow-hidden rounded-2xl border border-white/12 bg-slate-900/95 shadow-[0_30px_110px_rgba(0,0,0,0.62)] backdrop-blur">
                    <div className="p-2">
                      {sessionEmail ? (
                        <div className="px-3 pb-2 pt-1">
                          <div className="text-[11px] font-semibold tracking-wide text-foreground/45">
                            Signed in as
                          </div>
                          <div className="mt-1 truncate text-sm font-semibold text-foreground/80">
                            {sessionEmail}
                          </div>
                          <div className="mt-2 h-px bg-white/10" />
                        </div>
                      ) : null}

                      {sessionEmail ? (
                        <Link
                          href="/profile"
                          onClick={() => setMenuOpen(false)}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-foreground/80 transition hover:bg-white/10"
                        >
                          Profile
                        </Link>
                      ) : null}

                      {sessionEmail ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            void signOut();
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-foreground/80 transition hover:bg-white/10"
                        >
                          Switch account
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            setAuthOpen(true);
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-foreground/80 transition hover:bg-white/10"
                        >
                          Sign in
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-7 pt-4">
        <div className="flex-1">
          <section className="mt-7">
            <form onSubmit={onSubmit}>
              <label className="block">
                <span className="sr-only">Ask Binge</span>
                <div className="relative mx-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onPaste={onPaste}
                  placeholder="What do you want to watch, read, or listen to?"
                    className="h-[56px] w-full rounded-[28px] border border-white/28 bg-white/8 px-6 pr-16 text-[15px] font-medium text-white shadow-[0_18px_70px_rgba(0,0,0,0.40)] ring-1 ring-blue-200/16 outline-none placeholder:text-foreground/35 focus:border-blue-200/34 focus:bg-white/10 focus:ring-blue-200/26"
                    enterKeyHint="search"
                  />
                  <button
                    type="button"
                    onClick={toggleVoiceInput}
                    disabled={!speechSupported}
                    aria-label={
                      speechSupported
                        ? isListening
                          ? "Stop voice input"
                          : "Start voice input"
                        : "Voice input not supported"
                    }
                    className={`absolute right-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center text-foreground/70 transition duration-200 ${
                      speechSupported ? "hover:text-foreground/90 active:text-foreground" : "opacity-40"
                    } ${isListening ? "text-blue-200" : ""}`}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path
                        d="M12 14.5c1.66 0 3-1.34 3-3V6.5c0-1.66-1.34-3-3-3s-3 1.34-3 3v5c0 1.66 1.34 3 3 3Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M5.5 11.5c0 3.59 2.91 6.5 6.5 6.5s6.5-2.91 6.5-6.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M12 18v2.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </label>
              <div className="sr-only">{prompt}</div>
            </form>
          </section>

          <section className="mt-8 grid gap-4">
            <div className="px-1 text-center">
              <div className="text-[13px] font-medium tracking-tight text-foreground/50">
                Best for your time right now
              </div>
            </div>

            {todaysRecommendation ? (
              <Link
                href={`/content/${encodeURIComponent(todaysRecommendation.id)}`}
                onClick={() => openTodaysRecommendationInApp({ navigate: false })}
                className="group relative mx-2 overflow-hidden rounded-[28px] border border-white/12 bg-slate-950/55 p-[14px] text-left shadow-[0_22px_82px_rgba(0,0,0,0.48)] transition duration-200 active:scale-[0.99] active:shadow-[0_20px_74px_rgba(0,0,0,0.62)]"
              >
                <div className="pointer-events-none absolute -inset-10 bg-[radial-gradient(520px_circle_at_28%_18%,rgba(99,102,241,0.10),transparent_62%)] opacity-45" />

                <div className="px-1">
                  {todaysRecommendationTitle ? (
                    <div className="truncate text-[17px] font-semibold leading-7 text-foreground">
                      {todaysRecommendationTitle}
                    </div>
                  ) : null}
                </div>

                <div className="relative mt-3 overflow-hidden rounded-2xl ring-1 ring-white/10">
                  <div className="relative aspect-[16/9] w-full">
                    <Image
                      src={todaysRecommendation.thumbnailUrl}
                      alt="Recommended content thumbnail"
                      fill
                      sizes="(max-width: 1024px) 100vw, 512px"
                      className="object-cover"
                      priority
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-white/10 bg-slate-700/60 px-4 py-3">
                  {todaysRecommendationDescription ? (
                    <div className="line-clamp-2 text-sm leading-6 text-foreground/75">
                      {todaysRecommendationDescription}
                    </div>
                  ) : null}
                  <div className="mt-2 line-clamp-1 text-xs font-medium leading-5 text-foreground/50">
                    {todaysRecommendation.why}
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-2">
                      <span className="inline-flex h-4 w-fit items-center justify-center rounded-full bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        {todaysRecommendation.modality}
                      </span>
                      <span className="inline-flex h-4 w-fit items-center justify-center rounded-full bg-white/5 px-2 text-[11px] font-semibold text-white ring-1 ring-white/25">
                        {todaysRecommendation.durationMinutes} min
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          openTodaysRecommendationInApp();
                        }}
                        className="inline-flex h-11 min-w-24 items-center justify-center rounded-2xl bg-blue-500 px-5 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.30)] ring-1 ring-blue-200/30 transition duration-200 hover:bg-blue-500/95 active:bg-blue-400"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void shareRecommendation();
                        }}
                        className="inline-flex h-11 min-w-24 items-center justify-center rounded-2xl border border-white/20 bg-white/12 px-5 text-sm font-semibold text-foreground/90 shadow-[0_12px_45px_rgba(0,0,0,0.18)] transition duration-200 hover:bg-white/16 active:bg-white/18"
                      >
                        Share
                      </button>
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="mx-2 rounded-[28px] border border-white/12 bg-slate-950/45 px-5 py-6 text-left shadow-[0_18px_70px_rgba(0,0,0,0.32)]">
                <div className="text-sm font-semibold text-foreground/80">Save something to get started</div>
                <div className="mt-2 text-sm leading-6 text-foreground/55">
                  Your latest saved item will show up here.
                </div>
              </div>
            )}

            <Link
              href="/library"
              className="relative overflow-hidden rounded-[22px] border border-white/12 bg-white/6 px-4 py-4 shadow-[0_16px_60px_rgba(0,0,0,0.40)] transition duration-200 hover:bg-white/10 active:scale-[0.995]"
            >
              <div className="relative flex items-center justify-center">
                <div className="text-base font-semibold leading-7 text-foreground/85">My Library</div>
                <div className="pointer-events-none absolute right-4 text-foreground/50">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                    <path
                      d="M9 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          </section>
        </div>

        <footer className="mt-6 text-center text-xs font-medium text-foreground/30">
          Minimal prototype • No backend yet
        </footer>
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
                  <div className="text-sm font-semibold tracking-wide text-foreground/70">
                    Save to Binge
                  </div>
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
                    <div className="text-[11px] font-semibold tracking-wide text-foreground/45">
                      Duration (minutes)
                    </div>
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
                    <div className="text-[11px] font-semibold tracking-wide text-foreground/45">
                      Shared by
                    </div>

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
                      onClick={saveToLibrary}
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

      {authOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setAuthOpen(false);
              setAuthStatus("idle");
              setAuthError(null);
              setAuthCooldownUntilMs(0);
            }}
            className="absolute inset-0 bg-black/60"
          />

          <div className="absolute inset-x-0 top-20 mx-auto w-full max-w-lg px-4">
            <div className="overflow-hidden rounded-[28px] border border-white/12 bg-slate-900 shadow-[0_30px_120px_rgba(0,0,0,0.75)]">
              <div className="px-5 pb-5 pt-5">
                <div className="text-sm font-semibold tracking-tight text-foreground">Sign in</div>
                <div className="mt-1 text-xs font-medium text-foreground/55">
                  We’ll send you a sign-in link.
                </div>

                <label className="mt-4 block">
                  <span className="sr-only">Email</span>
                  <input
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    inputMode="email"
                    placeholder="you@example.com"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/10 px-4 text-sm font-semibold text-foreground outline-none placeholder:text-foreground/35 focus:border-white/18"
                  />
                </label>

                {!supabase ? (
                  <div className="mt-3 text-xs font-semibold text-foreground/60">
                    Auth isn’t configured yet. Add Supabase env vars and redeploy.
                  </div>
                ) : authNowMs < authCooldownUntilMs ? (
                  <div className="mt-3 text-xs font-semibold text-foreground/60">
                    Please wait {Math.ceil((authCooldownUntilMs - authNowMs) / 1000)}s before requesting another link.
                  </div>
                ) : authStatus === "sent" ? (
                  <div className="mt-3 text-xs font-semibold text-foreground/60">
                    Check your email for the link.
                  </div>
                ) : authStatus === "failed" ? (
                  <div className="mt-3 text-xs font-semibold text-foreground/60">
                    Couldn’t send the link. {authError ? `(${authError})` : "Try again."}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={() => void sendMagicLink()}
                    disabled={authStatus === "sending" || authNowMs < authCooldownUntilMs}
                    className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-blue-500/90 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30 transition duration-200 active:scale-[0.99] disabled:opacity-60"
                  >
                    {authStatus === "sending"
                      ? "Sending…"
                      : authEmail.trim()
                        ? `Send sign-in link to ${authEmail.trim()}`
                        : "Send sign-in link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthOpen(false);
                      setAuthStatus("idle");
                      setAuthError(null);
                      setAuthCooldownUntilMs(0);
                    }}
                    className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-sm font-semibold text-foreground/70 transition duration-200 hover:bg-white/10 active:bg-white/12"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ShareSheet open={!!shareSheet} data={shareSheet} onClose={() => setShareSheet(null)} />

      <SendToFriendSheet open={!!sendSheet} payload={sendSheet} onClose={() => setSendSheet(null)} />
    </div>
  );
}
