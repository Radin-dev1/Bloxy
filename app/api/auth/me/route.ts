import { json } from "../../../../lib/bridge";
import { bearerUser } from "../../../../lib/auth";

export async function GET(request: Request) {
  const user = await bearerUser(request);
  if (!user) return json({ error: "Not signed in" }, 401);
  return json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    balanceBits: user.balance_bits,
    plan: user.plan,
    renewsAt: user.renews_at,
  });
}
