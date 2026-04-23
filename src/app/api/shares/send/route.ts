import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

type Body = {
  toHandle?: string;
  url?: string;
  title?: string;
  summary?: string;
  thumbnailUrl?: string;
  source?: string;
  message?: string;
};

function normalizeHandle(value: string) {
  return value
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
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

  const toHandle = normalizeHandle(body.toHandle ?? "");
  const url = (body.url ?? "").trim();

  if (!toHandle) return NextResponse.json({ error: "Missing toHandle" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const supabase = getSupabaseServerClient(token);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, handle")
      .eq("handle", toHandle)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message || "Failed to resolve handle" }, { status: 500 });
    }

    if (!profile?.id) {
      return NextResponse.json({ error: "Handle not found" }, { status: 404 });
    }

    if (profile.id === userData.user.id) {
      return NextResponse.json({ error: "You can’t share to yourself" }, { status: 400 });
    }

    const payload = {
      from_user_id: userData.user.id,
      to_user_id: profile.id,
      url,
      title: body.title ?? null,
      summary: body.summary ?? body.message ?? null,
      thumbnail_url: body.thumbnailUrl ?? null,
      source: body.source ?? null,
    };

    const { error: insertError } = await supabase.from("shares").insert(payload);
    if (insertError) {
      return NextResponse.json({ error: insertError.message || "Failed to send" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
