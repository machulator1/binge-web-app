import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import { buildSavedItemPayloadFromUrl, rowToSavedItem, type SavedItemRow } from "@/lib/serverSaveToLibrary";
import { normalizeUrl } from "@/lib/urlImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  url?: unknown;
  token?: unknown;
};

type ProfileRow = {
  id: string;
  handle: string | null;
  save_token?: string | null;
};

function shortcutLog(message: string, details?: Record<string, string | number | boolean | null>) {
  console.log("[save-from-shortcut]", message, details ?? {});
}

function textFromShortcutValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : "";
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "URL", "absoluteString", "href", "text", "Text"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return "";
}

function userIdFromEnvToken(token: string) {
  const raw = (process.env.SHORTCUT_SAVE_TOKENS ?? "").trim();
  if (!raw) return null;

  for (const pair of raw.split(",")) {
    const [rawToken, rawUserId] = pair.split(":");
    const candidateToken = rawToken?.trim();
    const userId = rawUserId?.trim();
    if (candidateToken && userId && candidateToken === token) return userId;
  }

  return null;
}

async function findUserIdBySaveToken(token: string) {
  const envUserId = userIdFromEnvToken(token);
  if (envUserId) return envUserId;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, save_token")
    .eq("save_token", token)
    .maybeSingle();

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("save_token") || message.includes("schema cache")) {
      shortcutLog("save_token column unavailable on profiles");
      return null;
    }
    throw error;
  }

  const profile = data as ProfileRow | null;
  return profile?.id ?? null;
}

export async function POST(req: Request) {
  shortcutLog("incoming request");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    shortcutLog("invalid json");
    return NextResponse.json({ success: false, message: "Could not save this link" }, { status: 200 });
  }

  const rawUrl = textFromShortcutValue(body.url);
  const token = textFromShortcutValue(body.token);

  if (!rawUrl) {
    shortcutLog("missing url");
    return NextResponse.json({ success: false, message: "Missing URL" }, { status: 200 });
  }

  if (!token) {
    shortcutLog("missing token");
    return NextResponse.json({ success: false, message: "Missing token" }, { status: 200 });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(rawUrl);
    new URL(normalizedUrl);
  } catch {
    shortcutLog("invalid url");
    return NextResponse.json({ success: false, message: "Could not save this link" }, { status: 200 });
  }

  try {
    const userId = await findUserIdBySaveToken(token);
    if (!userId) {
      shortcutLog("missing or invalid token");
      return NextResponse.json({ success: false, message: "Invalid token" }, { status: 200 });
    }

    const supabase = getSupabaseServiceClient();
    const { payload, metadataFailed } = await buildSavedItemPayloadFromUrl(normalizedUrl, userId);

    if (metadataFailed) {
      shortcutLog("metadata fetch failure", { userId });
    }

    const urlsToCheck = Array.from(new Set([normalizedUrl, payload.url].filter(Boolean)));
    const { data: existingRows, error: existingError } = await supabase
      .from("saved_items")
      .select("id, created_at, user_id, url, title, modality, thumbnail_url, duration_minutes, source, saved_by, status, date_saved, description, notes")
      .eq("user_id", userId)
      .in("url", urlsToCheck)
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    const existing = Array.isArray(existingRows) ? (existingRows[0] as SavedItemRow | undefined) : undefined;
    if (existing) {
      shortcutLog("duplicate detected", { userId, itemId: existing.id });
      return NextResponse.json(
        {
          success: true,
          message: "Already saved to your library",
          itemId: existing.id,
          item: rowToSavedItem(existing),
        },
        { status: 200 },
      );
    }

    const { data, error } = await supabase
      .from("saved_items")
      .insert(payload)
      .select("id, created_at, user_id, url, title, modality, thumbnail_url, duration_minutes, source, saved_by, status, date_saved, description, notes")
      .maybeSingle();

    if (error || !data) {
      throw error ?? new Error("No saved item returned");
    }

    const row = data as SavedItemRow;
    shortcutLog("successful save", { userId, itemId: row.id });

    return NextResponse.json(
      {
        success: true,
        message: "Saved to Binge",
        itemId: row.id,
        item: rowToSavedItem(row),
      },
      { status: 200 },
    );
  } catch (error) {
    shortcutLog("save failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ success: false, message: "Could not save this link" }, { status: 200 });
  }
}
