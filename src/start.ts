import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { getConfiguredSiteUrl } from "./lib/site-url";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
//
// Behind a reverse proxy (EasyPanel/Traefik) the request URL the server sees is
// the internal one, so the Origin fallback would never match the public domain.
// When APP_URL/VITE_APP_URL is set we accept it too — the Sec-Fetch-Site check,
// which browsers always send and which runs first, is unaffected either way.
const configuredOrigin = getConfiguredSiteUrl();
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  ...(configuredOrigin
    ? {
        origin: (value: string, ctx: { request: Request }) =>
          value === configuredOrigin || value === new URL(ctx.request.url).origin,
      }
    : {}),
});

// A sessão viaja num cookie httpOnly, que o navegador já anexa sozinho em toda
// chamada de server function — não há mais token para um `functionMiddleware`
// global grudar no header.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
