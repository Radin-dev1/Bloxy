import { json } from "../../../../lib/bridge";
import { revokeUserSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  await revokeUserSession(request);
  return json({ ok: true });
}
