import {
  consumeOAuthState,
  createHandoff,
  exchangeOAuthCode,
  isOAuthProvider,
  issueUserSession,
  upsertOAuthUser,
} from "../../../../../../lib/auth";

const DEFAULT_RETURN_TO = "https://radin-dev1.github.io/Bloxy/workspace/";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url),
    code = url.searchParams.get("code") || "",
    state = url.searchParams.get("state") || "",
    providerError = url.searchParams.get("error");

  if (!isOAuthProvider(provider))
    return Response.redirect(
      `${DEFAULT_RETURN_TO}?authError=${encodeURIComponent("Unknown sign-in provider")}`,
      302,
    );

  // Consuming the state also validates it: an invalid or reused state means this callback
  // is not a genuine continuation of a request Bloxy issued, so the flow must abort here
  // rather than fall back to a default and continue — that fallback is only for *where to
  // show the error*, never a reason to proceed with the token exchange.
  const returnTo = await consumeOAuthState(provider, state);

  try {
    if (!returnTo) throw new Error("Sign-in session expired — try again");
    if (providerError) throw new Error(`Sign-in was cancelled (${providerError})`);
    if (!code) throw new Error("Sign-in did not return an authorization code");
    const redirectUri = `${url.origin}/api/auth/oauth/${provider}/callback`;
    const identity = await exchangeOAuthCode(provider, code, redirectUri);
    const userId = await upsertOAuthUser({ provider, ...identity });
    const sessionToken = await issueUserSession(userId);
    const handoffCode = await createHandoff(sessionToken);
    const redirect = new URL(returnTo);
    redirect.searchParams.set("authCode", handoffCode);
    return Response.redirect(redirect.toString(), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed";
    const redirect = new URL(returnTo || DEFAULT_RETURN_TO);
    redirect.searchParams.set("authError", message);
    return Response.redirect(redirect.toString(), 302);
  }
}
