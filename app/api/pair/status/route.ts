import { bearer, db, digest, json } from "../../../../lib/bridge";
export async function GET(request: Request) {
  const auth = bearer(request);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const row = await (
    await db()
  )
    .prepare("SELECT status,expires_at FROM bridge_sessions WHERE web_token_hash=?")
    .bind(await digest(auth))
    .first<{ status: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return json({ error: "Session expired" }, 401);
  return json({ status: row.status });
}
