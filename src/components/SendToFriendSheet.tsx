"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

const MAX_MESSAGE_LENGTH = 180;

type Payload = {
  url: string;
  title: string;
  summary?: string;
  thumbnailUrl?: string;
  source?: string;
};

export function SendToFriendSheet({
  open,
  payload,
  onClose,
}: {
  open: boolean;
  payload: Payload | null;
  onClose: () => void;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [handle, setHandle] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed" | "unauthorized">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setHandle("");
      setMessage("");
      setStatus("idle");
      setError(null);
    }
  }, [open]);

  const canSend = open && !!payload;

  async function send() {
    if (!payload) return;
    if (!supabase) {
      setStatus("unauthorized");
      setError("Auth not configured");
      return;
    }

    const h = handle.trim();
    if (!h) return;
    const trimmedMessage = message.trim();

    try {
      setStatus("sending");
      setError(null);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setStatus("unauthorized");
        return;
      }

      const res = await fetch("/api/shares/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          toHandle: h,
          url: payload.url,
          title: payload.title,
          summary: payload.summary,
          thumbnailUrl: payload.thumbnailUrl,
          source: payload.source,
          message: trimmedMessage || undefined,
        }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus("failed");
        setError(json?.error ?? "Failed to send");
        return;
      }

      setStatus("sent");
      window.setTimeout(() => onClose(), 700);
    } catch {
      setStatus("failed");
      setError("Failed to send");
    }
  }

  if (!open || !payload) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />

      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg px-4 pb-5">
        <div className="overflow-hidden rounded-[28px] border border-white/12 bg-slate-900 shadow-[0_30px_120px_rgba(0,0,0,0.75)]">
          <div className="px-5 pb-5 pt-5">
            <div className="text-sm font-semibold tracking-tight text-foreground">Send to friend</div>
            <div className="mt-1 line-clamp-2 text-xs font-medium text-foreground/55">{payload.title}</div>

            <label className="mt-4 block">
              <span className="sr-only">Handle</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@ava"
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/10 px-4 text-sm font-semibold text-foreground outline-none placeholder:text-foreground/35 focus:border-white/18"
              />
            </label>

            <label className="mt-3 block">
              <span className="sr-only">Comment</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                placeholder="Add a comment"
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                className="max-h-20 min-h-16 w-full resize-none rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm font-semibold leading-5 text-foreground outline-none placeholder:text-foreground/35 focus:border-white/18"
              />
              <span className="mt-1 block text-right text-[11px] font-semibold text-foreground/35">
                {message.length}/{MAX_MESSAGE_LENGTH}
              </span>
            </label>

            {status === "sent" ? (
              <div className="mt-3 text-xs font-semibold text-foreground/60">Sent.</div>
            ) : status === "unauthorized" ? (
              <div className="mt-3 text-xs font-semibold text-foreground/60">Sign in to send shares.</div>
            ) : status === "failed" ? (
              <div className="mt-3 text-xs font-semibold text-foreground/60">Couldn’t send. {error ? `(${error})` : ""}</div>
            ) : null}

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={!canSend || status === "sending"}
                onClick={() => void send()}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-blue-500/90 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30 transition duration-200 active:scale-[0.99] disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-sm font-semibold text-foreground/70 transition duration-200 hover:bg-white/10 active:bg-white/12"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
