/**
 * OAuth 2.0 com o Google.
 *
 * Fluxo de código de autorização com `access_type=offline`: o app recebe um
 * refresh token e passa a renovar o acesso sozinho, sem pedir consentimento a
 * cada vez. É chamado direto por HTTP em vez da biblioteca `googleapis` — são
 * dois endpoints, e assim a base fica configurável (o teste roda contra um
 * Google falso) sem arrastar uma dependência de dezenas de megabytes.
 */
import { getGoogleSettings } from "../postgres/config.server";

/** O que o app precisa: criar e mexer nos próprios eventos, e saber o e-mail. */
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"];

export type GoogleTokens = {
  accessToken: string;
  /** Só vem no primeiro consentimento; nas renovações o Google não reenvia. */
  refreshToken: string | undefined;
  expiresAt: Date;
  email: string | undefined;
};

/** Endereço para onde o Google devolve o usuário depois do consentimento. */
export function redirectUri(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/google/callback`;
}

/** URL de consentimento. `state` volta intacto e é o que amarra o retorno. */
export function authorizationUrl(input: { siteUrl: string; state: string }): string {
  const settings = getGoogleSettings();
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri(input.siteUrl),
    response_type: "code",
    scope: SCOPES.join(" "),
    // Sem os dois, o Google devolve só um access token de uma hora e a
    // sincronização morre quando o usuário fecha o navegador.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  return `${settings.authBaseUrl}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

/** E-mail que veio no id_token. O token chegou por TLS do próprio Google. */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return decoded.email;
  } catch {
    return undefined;
  }
}

async function requestTokens(body: Record<string, string>): Promise<GoogleTokens> {
  const settings = getGoogleSettings();
  const response = await fetch(settings.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      ...body,
    }).toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Google recusou a autenticação: ${payload.error_description ?? payload.error ?? response.status}`,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    email: emailFromIdToken(payload.id_token),
  };
}

export async function exchangeCode(input: {
  code: string;
  siteUrl: string;
}): Promise<GoogleTokens> {
  return requestTokens({
    code: input.code,
    redirect_uri: redirectUri(input.siteUrl),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return requestTokens({ refresh_token: refreshToken, grant_type: "refresh_token" });
}
