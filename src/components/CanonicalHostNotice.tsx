"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  canonicalHost: string;
};

export function CanonicalHostNotice({ canonicalHost }: Props) {
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    try {
      setHost(window.location.host);
    } catch {
      setHost(null);
    }
  }, []);

  const shouldShow = useMemo(() => {
    if (!host) return false;
    if (host === canonicalHost) return false;

    const looksLikeVercel = host.endsWith(".vercel.app") || host.includes("vercel");
    if (!looksLikeVercel) return false;

    return true;
  }, [canonicalHost, host]);

  const canonicalUrl = useMemo(() => {
    if (!host) return null;
    try {
      const u = new URL(window.location.href);
      u.host = canonicalHost;
      return u.toString();
    } catch {
      return `https://${canonicalHost}`;
    }
  }, [canonicalHost, host]);

  if (!shouldShow || !canonicalUrl) return null;

  return (
    <div className="sticky top-0 z-50 mx-auto w-full max-w-lg px-5 pt-4">
      <div className="rounded-[22px] border border-white/10 bg-slate-900/85 px-4 py-3 text-sm font-semibold text-foreground/80 shadow-[0_18px_70px_rgba(0,0,0,0.55)] backdrop-blur">
        <div className="text-foreground">You’re on a different Binge link.</div>
        <div className="mt-1 text-xs font-medium text-foreground/55">
          Your saved Library is tied to the exact URL. Switch to your main link to keep everything in one place.
        </div>
        <div className="mt-3">
          <a
            href={canonicalUrl}
            className="inline-flex h-9 items-center justify-center rounded-full border border-white/12 bg-white/5 px-4 text-xs font-semibold text-foreground/80 transition duration-200 hover:bg-white/10 active:bg-white/12"
          >
            Switch to {canonicalHost}
          </a>
        </div>
      </div>
    </div>
  );
}
