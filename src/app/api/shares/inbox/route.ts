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

    return NextResponse.json({ shares: (data ?? []) as ShareRow[] }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to load inbox" }, { status: 500 });
  }
}
