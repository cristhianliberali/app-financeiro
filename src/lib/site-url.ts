/**
 * URL pública da aplicação (ex.: https://financas.seudominio.com).
 *
 * Precisa ser configurável porque em produção o app roda atrás do proxy do
 * EasyPanel: o servidor Node só enxerga `localhost:3000`, então nada no
 * back-end consegue descobrir o domínio real sozinho.
 *
 * Ordem de resolução:
 *   1. `VITE_APP_URL` — injetada no bundle do cliente durante o build
 *   2. `APP_URL`      — lida em runtime pelo servidor (SSR e server functions)
 *   3. `window.location.origin` — fallback no navegador quando nada foi configurado
 */

function readEnv(): string | undefined {
  const fromVite = import.meta.env["VITE_APP_URL"];
  if (typeof fromVite === "string" && fromVite.trim()) return fromVite;

  // `process` não existe no bundle do navegador — só leia se estiver definido.
  if (typeof process !== "undefined") {
    const fromNode = process.env?.["APP_URL"];
    if (typeof fromNode === "string" && fromNode.trim()) return fromNode;
  }

  return undefined;
}

/** Domínio configurado por variável de ambiente, sem barra no final. */
export function getConfiguredSiteUrl(): string | undefined {
  const configured = readEnv();
  return configured ? configured.trim().replace(/\/+$/, "") : undefined;
}

/**
 * Origem a usar para links absolutos. Cai no `window.location.origin` quando
 * nenhum domínio foi configurado, e em string vazia durante o SSR (aí os
 * helpers abaixo devolvem caminhos relativos, que continuam válidos).
 */
export function getSiteUrl(): string {
  const configured = getConfiguredSiteUrl();
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Monta uma URL absoluta a partir de um caminho: `siteUrl("/convite")`. */
export function siteUrl(path = "/"): string {
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
