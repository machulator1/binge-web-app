"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export default function ProfilePage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [email, setEmail] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "unauthorized" | "failed">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!supabase) {
          if (!cancelled) setStatus("unauthorized");
          return;
        }

        setStatus("loading");
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) {
          if (!cancelled) setStatus("unauthorized");
          return;
        }

        setEmail(session.user.email ?? null);

        const { data: profile } = await supabase
          .from("profiles")
          .select("handle")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!cancelled) {
          setHandle(profile?.handle ?? "");
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("failed");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function normalizeHandle(value: string) {
    return value
      .trim()
      .replace(/^@/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 24);
  }

  async function save() {
    try {
      if (!supabase) {
        setStatus("unauthorized");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        setStatus("unauthorized");
        return;
      }

      const next = normalizeHandle(handle);
      if (!next) {
        setStatus("failed");
        setError("Handle is required.");
        return;
      }

      setStatus("saving");
      setError(null);

      const { error: upsertError } = await supabase.from("profiles").upsert({
        id: session.user.id,
        handle: next,
      });

      if (upsertError) {
        setStatus("failed");
        setError(upsertError.message);
        return;
      }

      setHandle(next);
      setStatus("saved");
      window.setTimeout(() => {
        setStatus("idle");
        router.push("/");
      }, 800);
    } catch {
      setStatus("failed");
      setError("Failed to save.");
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-10 pt-11">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-foreground">Profile</div>
            <div className="mt-1 text-sm font-medium text-foreground/55">{email ?? ""}</div>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-foreground/75 transition duration-200 hover:bg-white/10 active:bg-white/12"
          >
            Home
          </Link>
        </header>

        {status === "unauthorized" ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5 text-sm font-semibold text-foreground/70">
            Sign in to edit your profile.
          </div>
        ) : status === "loading" ? (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5 text-sm font-semibold text-foreground/70">
            Loading…
          </div>
        ) : (
          <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-800/60 p-5">
            <div className="text-sm font-semibold text-foreground/80">Your handle</div>
            <div className="mt-1 text-xs font-medium text-foreground/55">Friends will share to you using this.</div>

            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@maria"
              className="mt-3 h-12 w-full rounded-2xl border border-white/10 bg-black/10 px-4 text-sm font-semibold text-foreground outline-none placeholder:text-foreground/35 focus:border-white/18"
            />

            {status === "failed" && error ? (
              <div className="mt-3 text-xs font-semibold text-foreground/60">{error}</div>
            ) : null}

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={status === "saving"}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-blue-500/90 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30 transition duration-200 active:scale-[0.99] disabled:opacity-60"
              >
                {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save"}
              </button>
              <Link
                href="/"
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-sm font-semibold text-foreground/70 transition duration-200 hover:bg-white/10 active:bg-white/12"
              >
                Cancel
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
