import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ user: null }, { status: 200 });

  try {
    const supabase = getSupabaseServerClient(token);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return NextResponse.json({ user: null }, { status: 200 });

    return NextResponse.json(
      {
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
