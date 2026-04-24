import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

type ShareRow = {
  id: string;
  created_at: string;
  from_user_id: string;
  to_user_id: string;
  url: string;
  title: string | null;
  summary: string | null;
  thumbnail_url: string | null;
  source: string | null;
  opened_at: string | null;
};

type ProfileRow = {
  id: string;
  handle: string | null;
};

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseServerClient(token);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("shares")
      .select(
        "id, created_at, from_user_id, to_user_id, url, title, summary, thumbnail_url, source, opened_at",
      )
      .eq("to_user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: "Failed to load inbox" }, { status: 500 });
    }

    const rows = (data ?? []) as ShareRow[];
    const fromIds = Array.from(new Set(rows.map((r) => r.from_user_id).filter(Boolean)));

    let profilesById = new Map<string, string>();
    if (fromIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, handle")
        .in("id", fromIds);
      const typed = Array.isArray(profiles) ? (profiles as ProfileRow[]) : [];
      for (const p of typed) {
        const h = (p.handle ?? "").trim();
        if (p.id && h) profilesById.set(p.id, h);
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      fromHandle: profilesById.get(r.from_user_id) ?? null,
    }));

    return NextResponse.json({ shares: enriched }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to load inbox" }, { status: 500 });
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
      .from("shares")
      .delete()
      .eq("id", id)
      .eq("to_user_id", userData.user.id);

    if (error) return NextResponse.json({ error: error.message || "Failed to delete" }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
