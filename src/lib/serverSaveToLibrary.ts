import { resolveLinkMetadata } from "@/app/api/resolve-link/route";
import { buildMockSavedItem, normalizeUrl } from "@/lib/urlImport";

export type SavedItemRow = {
  id: string;
  created_at: string;
  user_id: string;
  url: string;
  title: string | null;
  modality: "article" | "video" | "podcast";
  thumbnail_url: string | null;
  duration_minutes: number | null;
  source: string | null;
  saved_by: string | null;
  status: "saved" | "in_progress" | "consumed" | null;
  date_saved: string | null;
  description: string | null;
  notes: string | null;
};

export function rowToSavedItem(row: SavedItemRow) {
  return {
    id: row.id,
    title: row.title ?? row.url,
    url: row.url,
    modality: row.modality,
    durationMinutes: row.duration_minutes ?? 5,
    source: row.source ?? "Saved",
    savedBy: row.saved_by ?? "Me",
    status: row.status ?? "saved",
    dateSaved: (row.date_saved ?? row.created_at ?? new Date().toISOString()).slice(0, 10),
    savedAt: row.created_at ?? (row.date_saved ? `${row.date_saved}T00:00:00.000Z` : undefined),
    thumbnailUrl: row.thumbnail_url ?? undefined,
    description: row.description ?? undefined,
    notes: row.notes ?? undefined,
    storage: "server" as const,
  };
}

export async function buildSavedItemPayloadFromUrl(rawUrl: string, userId: string) {
  const normalized = normalizeUrl(rawUrl);
  const fallback = buildMockSavedItem(normalized);

  try {
    const resolved = await resolveLinkMetadata(fallback.url);
    const title = (resolved.title ?? "").trim();
    const description = (resolved.description ?? "").trim();
    const savedAt = new Date().toISOString();

    return {
      payload: {
        user_id: userId,
        url: resolved.canonicalUrl ?? resolved.url ?? fallback.url,
        title: title ? title : fallback.title,
        modality: resolved.modality ?? fallback.modality,
        thumbnail_url: resolved.image ?? fallback.thumbnailUrl,
        duration_minutes: resolved.durationMinutes ?? fallback.durationMinutes,
        source: resolved.source ?? fallback.source,
        saved_by: "Me",
        status: "saved" as const,
        date_saved: savedAt.slice(0, 10),
        description: description ? description : fallback.description,
        notes: null,
      },
      metadataFailed: false,
    };
  } catch {
    return {
      payload: {
        user_id: userId,
        url: fallback.url,
        title: fallback.title,
        modality: fallback.modality,
        thumbnail_url: fallback.thumbnailUrl,
        duration_minutes: fallback.durationMinutes,
        source: fallback.source,
        saved_by: "Me",
        status: "saved" as const,
        date_saved: fallback.dateSaved,
        description: fallback.description,
        notes: null,
      },
      metadataFailed: true,
    };
  }
}
