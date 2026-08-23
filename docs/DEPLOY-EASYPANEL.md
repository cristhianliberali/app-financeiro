# Deploy no EasyPanel

Guia para publicar o app em um domínio próprio usando o EasyPanel.

O build gera um servidor Node standalone (Nitro, preset `node-server`) que faz
SSR e serve os arquivos estáticos no mesmo processo. Não é preciso Nginx nem um
bucket separado para o front.

---

## 1. Pré-requisitos

- Repositório no GitHub conectado ao EasyPanel.
- Um projeto Supabase (o app usa o mesmo banco em dev e produção, a menos que
  você crie um projeto separado).
- Um domínio ou subdomínio apontando para o servidor do EasyPanel.

---

## 2. Criar o serviço

No projeto do EasyPanel: **+ Service → App**.

**Aba Source**

| Campo | Valor |
| --- | --- |
| Provider | GitHub |
| Repository | `cristhianliberali/app-financeiro` |
| Branch | `main` |
| Build path | `/` |

> O EasyPanel builda o commit mais recente **dessa branch**. Se o `Dockerfile`
> ainda estiver só em uma branch de feature, o build falha com
> `failed to read dockerfile: no such file or directory` — mescle antes, ou
> aponte o campo Branch para a branch que já tem o arquivo.

**Aba Build**

| Campo | Valor |
| --- | --- |
| Method | `Dockerfile` |
| File | `Dockerfile` |

---

## 3. Variáveis de ambiente

Há dois momentos distintos, e confundi-los é o erro mais comum:

- **Build args** (`VITE_*`) — o Vite substitui essas variáveis pelo valor
  literal dentro do bundle do navegador **durante o build**. Defini-las apenas
  em runtime não tem efeito nenhum: o JavaScript já foi gerado.
- **Runtime** (sem prefixo) — lidas pelo servidor Node a cada request.

### 3.1 Build args (aba *Build → Build Args*)

```
VITE_SUPABASE_URL=https://esdleuxwybngrlunflzo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_SUPABASE_PROJECT_ID=esdleuxwybngrlunflzo
```

> Se você não passar nada aqui, o build usa os valores do `.env` versionado no
> repositório (que tem só URL e publishable key do Supabase, ambos públicos).

**Não passe `VITE_APP_URL`.** Por ser uma variável `VITE_`, o domínio é gravado
dentro do bundle no momento do build — se ele mudar depois, os e-mails de
confirmação, o retorno do login com Google e os links de convite continuam
apontando para o domínio antigo até alguém rebuildar a imagem. Em branco, o
navegador usa o domínio real de onde a página foi aberta, seja ele qual for, e
`APP_URL` (runtime, seção 3.2) cobre o lado do servidor. Preencha `VITE_APP_URL`
apenas no caso raro de o domínio canônico ser diferente do domínio acessado.

### 3.2 Runtime (aba *Environment*)

```
APP_URL=https://financas.seudominio.com
SUPABASE_URL=https://esdleuxwybngrlunflzo.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_PROJECT_ID=esdleuxwybngrlunflzo
SUPABASE_SERVICE_ROLE_KEY=<opcional, segredo>
LOVABLE_API_KEY=<opcional, segredo>
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
```

### 3.3 Referência

| Variável | Onde | Obrigatória | Para quê |
| --- | --- | --- | --- |
| `APP_URL` | runtime | recomendada | Domínio público, usado no SSR e na checagem de CSRF |
| `VITE_APP_URL` | build | **deixe em branco** | Só para domínio canônico ≠ domínio acessado; fixa o domínio no bundle |
| `VITE_SUPABASE_URL` | build | sim | Endpoint do Supabase no navegador |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | build | sim | Chave pública do Supabase no navegador |
| `VITE_SUPABASE_PROJECT_ID` | build | não | Identificação do projeto |
| `SUPABASE_URL` | runtime | sim | Endpoint do Supabase no servidor |
| `SUPABASE_PUBLISHABLE_KEY` | runtime | sim | Validação do token do usuário nas server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime | não | Client admin (ignora RLS). **Segredo** |
| `LOVABLE_API_KEY` | runtime | não | Importação de faturas por IA. **Segredo** |
| `PORT` | runtime | não | Porta do servidor (padrão `3000`) |
| `HOST` | runtime | sim | Precisa ser `0.0.0.0` para o proxy alcançar |

`APP_URL` vai com `https://` e **sem barra no final**. Se você preencher
`VITE_APP_URL`, ela precisa ter exatamente o mesmo valor.

Por que o domínio precisa ser configurado explicitamente: atrás do proxy do
EasyPanel o servidor Node só enxerga `localhost:3000`, então ele não tem como
descobrir sozinho o domínio real. Sem essas variáveis, os links de convite, o
`emailRedirectTo` do cadastro e o `redirect_uri` do login com Google só
funcionam a partir do navegador — e quebram no SSR.

---

## 4. Domínio e porta

**Aba Domains** → *Add Domain*:

| Campo | Valor |
| --- | --- |
| Host | `financas.seudominio.com` |
| Port | `3000` |
| HTTPS | ativado |
| Certificado | Let's Encrypt |

Aponte um registro `A` do seu DNS para o IP do servidor antes de emitir o
certificado.

O EasyPanel também cria um subdomínio próprio no formato
`<projeto>-<serviço>.<id>.easypanel.host`, que continua funcionando em paralelo
ao domínio próprio. Como `VITE_APP_URL` fica em branco (seção 3.1), o app se
comporta corretamente nos dois — basta que ambos estejam nas *Redirect URLs* do
Supabase (seção 6).

---

## 5. Health check

O app expõe `GET /api/health`, que responde `{"status":"ok"}` sem tocar no
banco. Configure em **Advanced → Health Check**:

| Campo | Valor |
| --- | --- |
| Path | `/api/health` |
| Port | `3000` |
| Interval | `30s` |

---

## 6. Configurar o Supabase para o novo domínio

Sem este passo o login por e-mail e o Google OAuth continuam redirecionando
para o domínio antigo. No painel do Supabase, em
**Authentication → URL Configuration**:

- **Site URL**: `https://financas.seudominio.com`
- **Redirect URLs**: adicione
  - `https://financas.seudominio.com`
  - `https://financas.seudominio.com/**`
  - o subdomínio `*.easypanel.host` e o `/**` dele, se pretende continuar
    acessando o app por ele

Se usa login com Google, adicione o mesmo domínio nas *Authorized redirect URIs*
do cliente OAuth no Google Cloud Console.

---

## 7. Deploy

Clique em **Deploy**. O primeiro build baixa as dependências e leva alguns
minutos; os seguintes aproveitam o cache de camadas do Docker.

Depois que subir, verifique:

```sh
curl https://financas.seudominio.com/api/health
# {"status":"ok","uptime":12.34}
```

---

## 8. Rodar a mesma imagem localmente

Útil para reproduzir um problema de produção antes de investigar no servidor:

```sh
docker build \
  --build-arg VITE_SUPABASE_URL=https://esdleuxwybngrlunflzo.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  -t app-financeiro .

docker run --rm -p 3000:3000 \
  -e APP_URL=http://localhost:3000 \
  -e SUPABASE_URL=https://esdleuxwybngrlunflzo.supabase.co \
  -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  app-financeiro
```

---

## 9. Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `failed to read dockerfile: no such file or directory` | O `Dockerfile` não existe na branch configurada em Source → Branch |
| Depois de trocar de domínio, os redirects ainda levam ao domínio antigo | `VITE_APP_URL` foi gravada em um build anterior; remova o build arg e rebuilde |
| Página em branco e `Missing Supabase environment variable(s)` no console do navegador | Faltaram os build args `VITE_SUPABASE_*` |
| Mesmo erro, mas nos logs do container | Faltaram as variáveis de runtime `SUPABASE_*` |
| E-mail de confirmação leva ao domínio errado | `Site URL` do Supabase desatualizada, ou `VITE_APP_URL` divergente |
| Link de convite gerado com domínio errado | `VITE_APP_URL` com barra no final ou apontando para outro host |
| `502 Bad Gateway` no EasyPanel | `HOST` diferente de `0.0.0.0`, ou porta do domínio diferente de `PORT` |
| `403 Forbidden` ao salvar transações | `APP_URL` não bate com o domínio de onde a página foi aberta |
| Importação por IA responde "IA indisponível no momento" | `LOVABLE_API_KEY` não configurada |

---

## Nota sobre a Lovable

O projeto continua conectado à Lovable, que faz o próprio build para Cloudflare
Workers. O `NITRO_PRESET=node-server` definido no `Dockerfile` vale só para o
build em container — dentro do ambiente da Lovable essa variável é ignorada, e
o editor segue funcionando normalmente. Os dois deploys convivem sem conflito.
