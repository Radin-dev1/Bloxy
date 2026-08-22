import { db, digest, json, token } from "../../../../lib/bridge";
export async function POST(request: Request) {
  const body = (await request.json()) as { code?: string };
  const pairCode = (body.code || "").toUpperCase().trim();
  const database = await db();
  const row = await database
    .prepare("SELECT id,expires_at FROM bridge_sessions WHERE pair_code=? AND status='waiting'")
    .bind(pairCode)
    .first<{ id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now())
    return json({ error: "Pairing code is invalid or expired" }, 404);
  const pluginToken = token();
  await database
    .prepare("UPDATE bridge_sessions SET plugin_token_hash=?,status='connected' WHERE id=?")
    .bind(await digest(pluginToken), row.id)
    .run();
  return json({ pluginToken, pollAfter: 2 });
}
