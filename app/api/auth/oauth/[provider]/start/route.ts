import {
  isOAuthProvider,
  oauthAuthorizeUrl,
  safeReturnTo,
  startOAuthState,
} from "../../../../../../lib/auth";

const DEFAULT_RETURN_TO = "https://radin-dev1.github.io/Bloxy/workspace/";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), DEFAULT_RETURN_TO);
  if (!isOAuthProvider(provider))
    return Response.redirect(
      `${returnTo}?authError=${encodeURIComponent("Unknown sign-in provider")}`,
      302,
    );
  try {
    const redirectUri = `${url.origin}/api/auth/oauth/${provider}/callback`;
    const state = await startOAuthState(provider, returnTo);
    return Response.redirect(oauthAuthorizeUrl(provider, redirectUri, state), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in is unavailable right now";
    return Response.redirect(`${returnTo}?authError=${encodeURIComponent(message)}`, 302);
  }
}
