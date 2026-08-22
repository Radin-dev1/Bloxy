import { db, json } from "../../../../../lib/bridge";
import { bearerUser } from "../../../../../lib/auth";
import { worldById, worldCard } from "../../../../../lib/worlds";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await bearerUser(request);
  if (!user) return json({ error: "Sign in first" }, 401);
  const world = await worldById(id);
  if (!world || world.owner_user_id !== user.id)
    return json({ error: "That world is not yours to publish" }, 404);
  const body = (await request.json().catch(() => ({}))) as { visibility?: string };
  const visibility = body.visibility === "private" ? "private" : "public";
  const database = await db();
  await database
    .prepare("UPDATE worlds SET visibility = ?, updated_at = ? WHERE id = ?")
    .bind(visibility, Date.now(), world.id)
    .run();
  const updated = await worldById(world.id);
  return json({ world: worldCard(updated!) });
}
