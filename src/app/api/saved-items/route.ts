import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

type SavedItemRow = {
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

type Body = {
  url?: string;
  title?: string;
  modality?: "article" | "video" | "podcast";
  thumbnailUrl?: string;
  durationMinutes?: number;
  source?: string;
  savedBy?: string;
  status?: "saved" | "in_progress" | "consumed";
  dateSaved?: string;
  description?: string;
  notes?: string;
};

function rowToItem(row: SavedItemRow) {
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
    thumbnailUrl: row.thumbnail_url ?? undefined,
    description: row.description ?? undefined,
    notes: row.notes ?? undefined,
    storage: "server" as const,
  };
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token)
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );

  try {
    const supabase = getSupabaseServerClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }

    const { data, error } = await supabase
      .from("saved_items")
      .select(
        "id, created_at, user_id, url, title, modality, thumbnail_url, duration_minutes, source, saved_by, status, date_saved, description, notes",
      )
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: "Failed to load" }, { status: 500 });

    const rows = Array.isArray(data) ? (data as SavedItemRow[]) : [];
    const items = rows.map(rowToItem);

    return NextResponse.json(
      { items },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to load" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  const modality = body.modality ?? "article";

  try {
    const supabase = getSupabaseServerClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = {
      user_id: userData.user.id,
      url,
      title: body.title ?? null,
      modality,
      thumbnail_url: body.thumbnailUrl ?? null,
      duration_minutes: typeof body.durationMinutes === "number" ? body.durationMinutes : null,
      source: body.source ?? null,
      saved_by: body.savedBy ?? "Me",
      status: body.status ?? "saved",
      date_saved: body.dateSaved ?? null,
      description: body.description ?? null,
      notes: body.notes ?? null,
    };

    const { data, error } = await supabase
      .from("saved_items")
      .upsert(payload, { onConflict: "user_id,url" })
      .select(
        "id, created_at, user_id, url, title, modality, thumbnail_url, duration_minutes, source, saved_by, status, date_saved, description, notes",
      )
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ item: rowToItem(data as SavedItemRow) }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const supabase = getSupabaseServerClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("saved_items")
      .delete()
      .eq("id", id)
      .eq("user_id", userData.user.id);

    if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
