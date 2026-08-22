import { bearer, json } from "../../../lib/bridge";
import { bearerUser } from "../../../lib/auth";
import { ACTION_COSTS, BITS_PER_DOLLAR, PRO_MONTHLY_BITS, walletForToken } from "../../../lib/bits";
export async function GET(request: Request) {
  const user = await bearerUser(request);
  if (user)
    return json({
      balanceBits: user.balance_bits,
      plan: user.plan,
      renewsAt: user.renews_at,
      bitsPerDollar: BITS_PER_DOLLAR,
      proMonthlyBits: PRO_MONTHLY_BITS,
      actionCosts: ACTION_COSTS,
      signedIn: true,
    });
  const auth = bearer(request);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const wallet = await walletForToken(auth);
  if (!wallet) return json({ error: "Wallet unavailable" }, 404);
  return json({
    balanceBits: wallet.balance_bits,
    plan: wallet.plan,
    renewsAt: wallet.renews_at,
    bitsPerDollar: BITS_PER_DOLLAR,
    proMonthlyBits: PRO_MONTHLY_BITS,
    actionCosts: ACTION_COSTS,
    signedIn: false,
  });
}
