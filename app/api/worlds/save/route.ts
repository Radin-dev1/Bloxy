import { db, json } from "../../../../lib/bridge";
import { bearerUser } from "../../../../lib/auth";
import { validateWorldInput, worldById, worldCard } from "../../../../lib/worlds";

export async function POST(request: Request) {
  const user = await bearerUser(request);
  if (!user) return json({ error: "Sign in to save worlds" }, 401);
  const body = (await request.json().catch(() => ({}))) as {
    worldId?: string;
    title?: string;
    prompt?: string;
    actions?: unknown;
    thumbnail?: string;
  };
  const input = validateWorldInput(body);
  if ("error" in input) return json({ error: input.error }, 400);
  const database = await db();
  const now = Date.now();
  if (body.worldId) {
    const existing = await worldById(String(body.worldId));
    if (!existing || existing.owner_user_id !== user.id)
      return json({ error: "That world is not yours to update" }, 404);
    await database
      .prepare(
        "UPDATE worlds SET title = ?, prompt = ?, actions_json = ?, thumbnail = COALESCE(?, thumbnail), updated_at = ? WHERE id = ?",
      )
      .bind(input.title, input.prompt, input.actionsJson, input.thumbnail, now, existing.id)
      .run();
    const updated = await worldById(existing.id);
    return json({ world: worldCard(updated!) });
  }
  const id = crypto.randomUUID();
  await database
    .prepare(
      "INSERT INTO worlds (id, owner_user_id, title, prompt, actions_json, thumbnail, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(id, user.id, input.title, input.prompt, input.actionsJson, input.thumbnail, now, now)
    .run();
  const created = await worldById(id);
  return json({ world: worldCard(created!) }, 201);
}
