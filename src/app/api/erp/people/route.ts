// Sync asks who can be invited: the active people on the team list, by address, so its booking form
// offers only people this app can invite.

import { erpGuard, erpJson } from "@/lib/erp/guard";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refused = erpGuard(request);
  if (refused) return refused;
  const { data, error } = await supabaseAdmin().from("people").select("email, full_name").eq("active", true).order("full_name");
  if (error) return erpJson({ error: `Couldn't read the team list: ${error.message}` }, 500);
  return erpJson({ people: data ?? [] });
}
