# Imagem de produção para o EasyPanel (ou qualquer host com Docker).
# O build gera um servidor Node standalone via Nitro em `.output/`, e o estágio
# final carrega só esse diretório — sem bun, sem node_modules da aplicação.
#
# Guia completo de deploy: docs/DEPLOY-EASYPANEL.md

# ──────────────────────────── build ────────────────────────────
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

# O EasyPanel injeta GIT_SHA em todo build; declarar aqui só evita o aviso
# "one or more build-args were not consumed" no log.
ARG GIT_SHA

# As variáveis VITE_* são inlined no bundle do cliente durante o build, então
# precisam existir aqui como build args — defini-las só em runtime não adianta.
# A contrapartida: mudar qualquer uma delas exige rebuild da imagem.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID

# VITE_APP_URL é opcional e, em geral, é melhor deixar em branco: sem ela o
# cliente usa o domínio de onde a página foi aberta (window.location.origin), e
# trocar de domínio passa a ser só editar APP_URL em runtime, sem rebuild.
# Informe apenas se o domínio canônico for diferente do domínio acessado.
ARG VITE_APP_URL
ENV VITE_APP_URL=$VITE_APP_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

# Fora do build da Lovable esta env escolhe o alvo do Nitro; o padrão seria
# Cloudflare Workers, que não roda em container. Dentro da Lovable ela é
# ignorada, então o build do editor continua indo para Cloudflare como sempre.
ENV NITRO_PRESET=node-server

COPY package.json bun.lock bunfig.toml ./

# O bun.lock traz alguns pacotes resolvidos pelo cache npm interno da Lovable,
# que não é acessível fora do sandbox dela. Apontamos essas entradas para o
# registry público — mesmas versões, e o bun continua conferindo os hashes de
# integridade gravados no lockfile.
RUN sed -i 's|europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache|registry.npmjs.org|g' bun.lock \
    && bun install --frozen-lockfile

COPY . .
RUN bun run build

# ─────────────────────────── runtime ───────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# O EasyPanel injeta PORT; 3000 é o padrão do Nitro e o valor sugerido no painel.
ENV PORT=3000
# Precisa escutar em todas as interfaces para o proxy do EasyPanel alcançar.
ENV HOST=0.0.0.0

COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
