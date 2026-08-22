import { json } from "../../../../lib/bridge";
import { createUser, findUserByEmail, hashPassword, issueUserSession } from "../../../../lib/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    displayName?: string;
  };
  const email = (body.email || "").trim().toLowerCase(),
    password = body.password || "",
    displayName = (body.displayName || "").trim().slice(0, 60) || email.split("@")[0];
  if (!EMAIL_PATTERN.test(email)) return json({ error: "Enter a valid email address" }, 400);
  if (password.length < 8) return json({ error: "Password needs at least 8 characters" }, 400);
  if (await findUserByEmail(email))
    return json({ error: "An account with that email already exists" }, 409);
  const passwordHash = await hashPassword(password);
  const userId = await createUser({ email, passwordHash, displayName });
  const token = await issueUserSession(userId);
  return json({ token, user: { id: userId, email, displayName } });
}
