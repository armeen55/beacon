import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { saveConnectorToken } from "@/lib/connector-store";
import { exchangeGoogleCode, getRedirectUri } from "@/lib/connectors/google-auth";

const SETTINGS_PATH = "/settings/connectors";

function settingsRedirect(
  request: Request,
  params: Record<string, string>,
): NextResponse {
  const origin = new URL(request.url).origin;
  const qs = new URLSearchParams(params).toString();
  return NextResponse.redirect(`${origin}${SETTINGS_PATH}?${qs}`);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    log.warn("Google OAuth denied by user", { error });
    return settingsRedirect(request, { error: "access_denied" });
  }

  if (!code) {
    log.warn("Google OAuth callback missing code parameter");
    return settingsRedirect(request, { error: "no_code" });
  }

  try {
    const tokens = await exchangeGoogleCode(code);

    if (!tokens.refresh_token) {
      log.warn("Google did not return a refresh token — user may need to re-authorize with prompt=consent");
    }

    saveConnectorToken({
      provider: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? "",
      expires_at: Date.now() + tokens.expires_in * 1000,
      connected_at: new Date().toISOString(),
      scopes: tokens.scope ? tokens.scope.split(" ") : [],
    });

    log.info("Google connector authorized", {
      expiresIn: tokens.expires_in,
      hasRefresh: !!tokens.refresh_token,
    });

    return settingsRedirect(request, { connected: "google" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Google OAuth token exchange failed", {
      error: msg.slice(0, 500),
    });
    return settingsRedirect(request, { error: "exchange_failed" });
  }
}
