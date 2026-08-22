import { json } from "../../../../lib/bridge";
import { consumeHandoff, sessionUserByToken } from "../../../../lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const token = await consumeHandoff((body.code || "").trim());
  if (!token) return json({ error: "This sign-in link expired. Try signing in again." }, 400);
  const user = await sessionUserByToken(token);
  if (!user) return json({ error: "Sign-in failed" }, 401);
  return json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
}
