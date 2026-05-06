import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function createToken() {
  return `binge_${randomBytes(18).toString("base64url")}`;
}

type ProfileRow = {
  id: string;
  save_token: string | null;
};

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = getSupabaseServerClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: existing, error: loadError } = await supabase
      .from("profiles")
      .select("id, save_token")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json({ error: "Shortcut tokens need database setup" }, { status: 500 });
    }

    const existingToken = ((existing as ProfileRow | null)?.save_token ?? "").trim();
    if (existingToken) {
      return NextResponse.json({ saveToken: existingToken }, { status: 200 });
    }

    const saveToken = createToken();
    const { error: upsertError } = await supabase.from("profiles").upsert({
      id: userData.user.id,
      save_token: saveToken,
    });

    if (upsertError) {
      return NextResponse.json({ error: "Could not create shortcut token" }, { status: 500 });
    }

    return NextResponse.json({ saveToken }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Could not load shortcut token" }, { status: 500 });
  }
}
