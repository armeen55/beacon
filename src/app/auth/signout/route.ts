import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 });
}
