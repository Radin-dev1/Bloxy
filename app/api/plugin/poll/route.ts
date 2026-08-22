import { bearer, db, digest, json } from "../../../../lib/bridge";
export async function GET(request: Request) {
  const auth = bearer(request);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const database = await db();
  const session = await database
    .prepare("SELECT id FROM bridge_sessions WHERE plugin_token_hash=? AND status='connected'")
    .bind(await digest(auth))
    .first<{ id: string }>();
  if (!session) return json({ error: "Plugin session expired" }, 401);
  const job = await database
    .prepare(
      "SELECT id,prompt,actions_json FROM build_jobs WHERE session_id=? AND status='pending' ORDER BY created_at LIMIT 1",
    )
    .bind(session.id)
    .first<{ id: string; prompt: string; actions_json: string }>();
  return json(
    job
      ? { job: { id: job.id, prompt: job.prompt, actions: JSON.parse(job.actions_json) } }
      : { job: null },
  );
}
