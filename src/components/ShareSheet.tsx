"use client";

import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/nativeShare";

export type ShareSheetData = {
  title: string;
  text?: string;
  url: string;
};

export function ShareSheet({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: ShareSheetData | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  if (!open || !data) return null;
  const sheetData = data;

  async function onCopy() {
    const ok = await copyToClipboard(sheetData.url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  function onOpenOriginal() {
    window.open(sheetData.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg px-4 pb-5">
        <div className="overflow-hidden rounded-[28px] border border-white/12 bg-slate-900 shadow-[0_30px_120px_rgba(0,0,0,0.75)]">
          <div className="px-5 pb-5 pt-5">
            <div className="text-sm font-semibold tracking-tight text-foreground">Share</div>
            <div className="mt-1 line-clamp-2 text-xs font-medium text-foreground/55">
              {sheetData.title}
            </div>

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void onCopy()}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-sm font-semibold text-foreground/80 transition duration-200 hover:bg-white/10 active:bg-white/12"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={onOpenOriginal}
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-blue-500/90 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-blue-300/30 transition duration-200 active:scale-[0.99]"
              >
                Open original
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
