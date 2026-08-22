import { json } from "../../../../lib/bridge";
import { bearerUser } from "../../../../lib/auth";
import { worldCard, worldsByOwner } from "../../../../lib/worlds";

export async function GET(request: Request) {
  const user = await bearerUser(request);
  if (!user) return json({ error: "Sign in to see your worlds" }, 401);
  const rows = await worldsByOwner(user.id);
  return json({ worlds: rows.map(worldCard) });
}
