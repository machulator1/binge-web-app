"use client";

import { useCallback, useState } from "react";
import { buildMockSavedItem, normalizeUrl, type SavedModality } from "@/lib/urlImport";

export type ResolvedLink = {
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

export type SaveDraft = Omit<
  ReturnType<typeof buildMockSavedItem>,
  never
> & {
  savedBy: string;
  notes: string;
  provider?: string;
  canonicalUrl?: string;
};

const SAVED_ITEMS_STORAGE_KEY = "binge_saved_items_v1";

export function useSaveToBingeFlow({
  sessionToken,
  onServerSaved,
}: {
  sessionToken: string | null;
  onServerSaved?: (item: unknown) => void;
}) {
  const [saveUrl, setSaveUrl] = useState<string | null>(null);
  const [saveDraft, setSaveDraft] = useState<SaveDraft | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saved">("idle");
  const [resolveStatus, setResolveStatus] = useState<"idle" | "loading" | "resolved" | "failed">(
    "idle",
  );

  const closeSaveFlow = useCallback(() => {
    setSaveUrl(null);
    setSaveDraft(null);
    setSaveFeedback("idle");
    setResolveStatus("idle");
  }, []);

  const resolveLink = useCallback(async (url: string) => {
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
        const nextTitle = (data.title ?? "").trim();
        const nextDescription = (data.description ?? "").trim();
        return {
          ...prev,
          title: nextTitle ? nextTitle : prev.title,
          description: nextDescription ? nextDescription : prev.description,
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
  }, []);

  const openFromUrl = useCallback(
    (raw: string) => {
      const normalized = normalizeUrl(raw);
      const base = buildMockSavedItem(normalized);
      setSaveUrl(base.url);
      setSaveDraft({ ...base, savedBy: "Me", notes: "" });
      void resolveLink(base.url);
    },
    [resolveLink],
  );

  const saveToLibrary = useCallback(async () => {
    if (!saveDraft) return { localItem: null, serverItem: null };

    const localItem = {
      id: `u_${Date.now().toString(36)}`,
      title: saveDraft.title,
      url: saveDraft.url,
      modality: saveDraft.modality,
      thumbnailUrl: saveDraft.thumbnailUrl,
      durationMinutes: saveDraft.durationMinutes,
      source: saveDraft.source,
      savedBy: saveDraft.savedBy.trim() ? saveDraft.savedBy.trim() : "Me",
      status: "saved" as const,
      dateSaved: saveDraft.dateSaved,
      description: saveDraft.description,
      notes: saveDraft.notes.trim() ? saveDraft.notes.trim() : undefined,
    };

    let serverItem: unknown = null;

    if (sessionToken) {
      try {
        const res = await fetch("/api/saved-items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            url: localItem.url,
            title: localItem.title,
            modality: localItem.modality,
            thumbnailUrl: localItem.thumbnailUrl,
            durationMinutes: localItem.durationMinutes,
            source: localItem.source,
            savedBy: localItem.savedBy,
            status: localItem.status,
            dateSaved: localItem.dateSaved,
            description: localItem.description,
            notes: localItem.notes,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as { item?: unknown };
          if (data.item) {
            serverItem = data.item;
            onServerSaved?.(data.item);
          }
        }
      } catch {
        // Ignore server persistence failures
      }
    }

    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SAVED_ITEMS_STORAGE_KEY) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const existing = Array.isArray(parsed) ? (parsed as unknown[]) : [];
      const next = [localItem, ...existing].slice(0, 200);
      window.localStorage.setItem(SAVED_ITEMS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }

    setSaveFeedback("saved");
    return { localItem, serverItem };
  }, [onServerSaved, saveDraft, sessionToken]);

  return {
    saveUrl,
    saveDraft,
    setSaveDraft,
    saveFeedback,
    resolveStatus,
    openFromUrl,
    closeSaveFlow,
    saveToLibrary,
  };
}
