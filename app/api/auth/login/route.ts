import { json } from "../../../../lib/bridge";
import { findUserByEmail, issueUserSession, verifyPassword } from "../../../../lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email || "").trim().toLowerCase(),
    password = body.password || "";
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash)))
    return json({ error: "Incorrect email or password" }, 401);
  const token = await issueUserSession(user.id);
  return json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
}
