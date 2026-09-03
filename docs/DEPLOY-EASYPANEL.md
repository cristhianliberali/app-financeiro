# Deploy no EasyPanel

Guia para publicar o app em um domínio próprio usando o EasyPanel.

O build gera um servidor Node standalone (Nitro, preset `node-server`) que faz
SSR e serve os arquivos estáticos no mesmo processo. Não é preciso Nginx nem um
bucket separado para o front.

---

## 1. Pré-requisitos

- Repositório no GitHub conectado ao EasyPanel.
- Um Postgres acessível a partir do container, com o schema de `db/schema.sql`
  já aplicado (veja `db/README.md`). Pode ser um serviço Postgres do próprio
  EasyPanel ou um banco externo.
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

Nenhuma variável do banco é build arg: o Postgres é acessado só pelo servidor
Node, em runtime. Na prática, o único build arg possível é `VITE_APP_URL` — e
**o normal é não passá-lo**.

Por ser uma variável `VITE_`, o domínio é gravado dentro do bundle no momento do
build: se ele mudar depois, os links de convite continuam apontando para o
antigo até alguém rebuildar a imagem. Em branco, o navegador usa o domínio real
de onde a página foi aberta, e `APP_URL` (runtime, seção 3.2) cobre o lado do
servidor. Preencha `VITE_APP_URL` apenas no caso raro de o domínio canônico ser
diferente do domínio acessado — e, se preencher, use a variável do painel:

```
VITE_APP_URL=https://$(PRIMARY_DOMAIN)
```

### 3.2 Runtime (aba *Environment*)

```
APP_URL=https://financas.seudominio.com
POSTGRES_HOST=186.226.112.41
POSTGRES_PORT=5437
POSTGRES_DB=app_financeiro_pg
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<segredo>
POSTGRES_SSL=false
POSTGRES_SCHEMA=public
CREATE_USERS_HOME=true
PROVEDOR_IA=openai
MODELO_IA=gpt-4o-mini
OPENAI_API_KEY=<opcional, segredo>
LIMITE_TOKENS=12000
LIMITE_LANCAMENTOS_LOTE=40
LOG_IA=true
SMTP_HOST=<opcional>
SMTP_PORT=587
SMTP_USER=<opcional>
SMTP_PASSWORD=<opcional, segredo>
SMTP_FROM=nao-responda@seudominio.com
SMTP_FROM_NAME=Aura Finanças
S3_BUCKET=<opcional>
S3_ACCESS_KEY_ID=<opcional, segredo>
S3_SECRET_ACCESS_KEY=<opcional, segredo>
S3_ENDPOINT=<opcional, para MinIO/R2/B2>
S3_REGION=us-east-1
S3_MAX_UPLOAD_MB=50
GOOGLE_CLIENT_ID=<opcional>
GOOGLE_CLIENT_SECRET=<opcional, segredo>
GOOGLE_CALENDAR_TIMEZONE=America/Sao_Paulo
GOOGLE_SYNC_INTERVALO_MINUTOS=10
GOOGLE_SYNC_TOKEN=<opcional, segredo>
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
```

Se o Postgres for um serviço do mesmo projeto no EasyPanel, use o nome interno
do serviço como `POSTGRES_HOST` (ex.: `app-financeiro_postgres`) e a porta
interna `5432` — assim o tráfego não sai para a internet.

### 3.3 Referência

| Variável | Onde | Obrigatória | Para quê |
| --- | --- | --- | --- |
| `APP_URL` | runtime | recomendada | Domínio público, usado nos links de convite, na checagem de CSRF e para decidir se o cookie de sessão é `Secure` |
| `VITE_APP_URL` | build | **deixe em branco** | Só para domínio canônico ≠ domínio acessado; fixa o domínio no bundle |
| `POSTGRES_HOST` | runtime | sim | Host do banco |
| `POSTGRES_PORT` | runtime | não | Porta (padrão `5432`) |
| `POSTGRES_DB` | runtime | sim | Nome do banco |
| `POSTGRES_USER` | runtime | sim | Usuário do banco |
| `POSTGRES_PASSWORD` | runtime | sim | Senha do banco. **Segredo** |
| `POSTGRES_SSL` | runtime | não | `true` se o banco exigir TLS (padrão `false`) |
| `POSTGRES_SCHEMA` | runtime | não | Schema das tabelas (padrão `public`) |
| `POSTGRES_POOL_MAX` | runtime | não | Conexões simultâneas por processo (padrão `10`) |
| `CREATE_USERS_HOME` | runtime | não | `true` mostra o cadastro na tela inicial; `false` deixa o app só por convite |
| `SESSION_COOKIE_NAME` | runtime | não | Nome do cookie de sessão (padrão `aura_session`) |
| `SESSION_TTL_DAYS` | runtime | não | Validade da sessão em dias (padrão `30`) |
| `PROVEDOR_IA` | runtime | não | Provedor de IA da importação de faturas (padrão e único aceito hoje: `openai`) |
| `MODELO_IA` | runtime | não | Modelo usado nas requisições de importação (ex.: `gpt-4o-mini`) |
| `OPENAI_API_KEY` | runtime | não | Chave do provedor. Sem ela a importação por IA fica indisponível. **Segredo** |
| `LIMITE_TOKENS` | runtime | não | Tokens do documento por requisição (padrão `12000`); acima disso vira lote |
| `LIMITE_LANCAMENTOS_LOTE` | runtime | não | Lançamentos por requisição (padrão `40`). Lote grande faz o modelo pular linhas; baixe para `20`–`25` se ainda faltar lançamento |
| `LOG_IA` | runtime | não | Registra no log do container o que foi enviado à IA e o que ela devolveu (padrão `true`) |
| `LOG_IA_CORPO` | runtime | não | `false` registra só modelo, tokens e duração, sem prompt nem resposta (padrão `true`) |
| `LOG_IA_LIMITE_CARACTERES` | runtime | não | Teto de caracteres de cada trecho registrado (padrão `2000`) |
| `SMTP_HOST` | runtime | não | Servidor de e-mail. Sem ele, redefinição de senha e troca de e-mail ficam indisponíveis |
| `SMTP_PORT` | runtime | não | Porta do SMTP (padrão `587`) |
| `SMTP_SECURE` | runtime | não | `true` para TLS direto; sem valor, é `true` só na porta `465` |
| `SMTP_USER` | runtime | não | Usuário da autenticação SMTP |
| `SMTP_PASSWORD` | runtime | não | Senha ou *app password* do SMTP. **Segredo** |
| `SMTP_FROM` | runtime | não | Endereço remetente (padrão: o valor de `SMTP_USER`) |
| `SMTP_FROM_NAME` | runtime | não | Nome exibido no remetente (padrão `Aura Finanças`) |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | runtime | não | `false` aceita certificado autoassinado (padrão `true`) |
| `S3_BUCKET` | runtime | não | Bucket dos anexos de tarefa. Sem ele, os anexos ficam indisponíveis |
| `S3_ACCESS_KEY_ID` | runtime | não | Chave de acesso do bucket. **Segredo** |
| `S3_SECRET_ACCESS_KEY` | runtime | não | Segredo da chave de acesso. **Segredo** |
| `S3_ENDPOINT` | runtime | não | Endpoint do serviço compatível (MinIO, R2, B2…). Vazio usa a AWS |
| `S3_REGION` | runtime | não | Região do bucket (padrão `us-east-1`) |
| `S3_FORCE_PATH_STYLE` | runtime | não | `true` para `host/bucket/chave`. Em branco, segue o endpoint |
| `S3_MAX_UPLOAD_MB` | runtime | não | Teto por arquivo em MB (padrão `50`) |
| `S3_URL_TTL_SEGUNDOS` | runtime | não | Validade das URLs assinadas (padrão `900`) |
| `GOOGLE_CLIENT_ID` | runtime | não | ID do cliente OAuth do Google Cloud. Sem ele, a agenda fica indisponível |
| `GOOGLE_CLIENT_SECRET` | runtime | não | Segredo do cliente OAuth. **Segredo** |
| `GOOGLE_CALENDAR_TIMEZONE` | runtime | não | Fuso dos compromissos criados (padrão `America/Sao_Paulo`) |
| `GOOGLE_SYNC_INTERVALO_MINUTOS` | runtime | não | Intervalo da sincronização automática (padrão `10`) |
| `GOOGLE_MAX_EVENTOS_SYNC` | runtime | não | Teto de eventos lidos por sincronização (padrão `500`) |
| `GOOGLE_TOKEN_SECRET` | runtime | não | Chave que cifra os tokens no banco; sem valor, deriva de `GOOGLE_CLIENT_SECRET` |
| `GOOGLE_SYNC_TOKEN` | runtime | não | Segredo que libera `POST /api/google/sync`. Sem valor, a rota fica fechada. **Segredo** |
| `PORT` | runtime | não | Porta do servidor (padrão `3000`) |
| `HOST` | runtime | sim | Precisa ser `0.0.0.0` para o proxy alcançar |

`APP_URL` vai com `https://` e **sem barra no final**. Se você preencher
`VITE_APP_URL`, ela precisa ter exatamente o mesmo valor.

Por que o domínio precisa ser configurado explicitamente: atrás do proxy do
EasyPanel o servidor Node só enxerga `localhost:3000`, então ele não tem como
descobrir sozinho o domínio real. Sem `APP_URL`, os links de convite gerados no
SSR saem sem host, e o cookie de sessão não é marcado como `Secure`.

---

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
comporta corretamente nos dois.

---

## 5. Health check

O app expõe `GET /api/health`, que responde `{"status":"ok"}` sem tocar no
banco — de propósito: o health check serve para saber se o processo Node subiu,
não se as dependências estão de pé. Para incluir um ping no Postgres (503 quando
o banco não responde), use `GET /api/health?db=1`.

Configure em **Advanced → Health Check**:

| Campo | Valor |
| --- | --- |
| Path | `/api/health` |
| Port | `3000` |
| Interval | `30s` |

---

## 6. Preparar o banco

Antes do primeiro deploy — e a cada atualização que traga tabelas novas, como o
módulo Tarefas e Projetos — aplique o `db/schema.sql` no Postgres. Ele é SQL
puro e idempotente: rodá-lo de novo em um banco já populado não apaga dados.

Do terminal, usando as mesmas variáveis `POSTGRES_*` do serviço:

```sh
bun run db:migrate
```

Sem terminal? Cole o conteúdo de `db/schema.sql` inteiro no console SQL do
painel e execute — o arquivo foi feito para caber em uma colagem só. Com psql à
mão, também funciona:

```sh
psql "postgresql://USUARIO:SENHA@HOST:PORTA/BANCO" -v ON_ERROR_STOP=1 -f db/schema.sql
```

Detalhes e a lista de tabelas estão em `db/README.md`.

Depois que o serviço subir, o primeiro acesso cria o usuário, a conta e os
perfis padrão pela própria tela inicial — desde que `CREATE_USERS_HOME=true`.
Com o banco vazio o cadastro é liberado mesmo com a variável em `false`, senão
não haveria como entrar. Feito o primeiro login, mude para `false` se quiser que
o app funcione só por convite.

---

## 7. Deploy

Clique em **Deploy**. O primeiro build baixa as dependências e leva alguns
minutos; os seguintes aproveitam o cache de camadas do Docker.

Depois que subir, verifique:

```sh
curl https://financas.seudominio.com/api/health
# {"status":"ok","uptime":12.34}

curl "https://financas.seudominio.com/api/health?db=1"
# {"status":"ok","uptime":12.34,"database":"up"}
```

---

## 8. Rodar a mesma imagem localmente

Útil para reproduzir um problema de produção antes de investigar no servidor:

```sh
docker build -t app-financeiro .

docker run --rm -p 3000:3000 \
  -e APP_URL=http://localhost:3000 \
  -e POSTGRES_HOST=186.226.112.41 \
  -e POSTGRES_PORT=5437 \
  -e POSTGRES_DB=app_financeiro_pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=... \
  -e POSTGRES_SSL=false \
  -e POSTGRES_SCHEMA=public \
  -e CREATE_USERS_HOME=true \
  app-financeiro
```

---

## 9. Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `failed to read dockerfile: no such file or directory` | O `Dockerfile` não existe na branch configurada em Source → Branch |
| Depois de trocar de domínio, os redirects ainda levam ao domínio antigo | `VITE_APP_URL` foi gravada em um build anterior; remova o build arg e rebuilde |
| `Variáveis de ambiente do Postgres ausentes: ...` nos logs do container | Faltou alguma das `POSTGRES_*` na aba Environment |
| Login falha e o log mostra erro de conexão do `pg` | Host/porta errados, banco fora do ar, ou firewall bloqueando o container |
| `relation "app_users" does not exist` | O `db/schema.sql` não foi aplicado, ou `POSTGRES_SCHEMA` aponta para outro schema |
| `syntax error at or near "\"` ao aplicar o SQL | Versão antiga do `db/schema.sql`, que usava comandos do psql. Pegue a versão atual do repositório |
| Tela de entrada sem a opção de criar conta | `CREATE_USERS_HOME=false` — comportamento esperado; entre por convite |
| Login "esquece" a cada request | `APP_URL` em `https://` mas o app servido em `http://` (o cookie `Secure` não volta) |
| Link de convite gerado com domínio errado | `VITE_APP_URL` com barra no final ou apontando para outro host |
| `502 Bad Gateway` no EasyPanel | `HOST` diferente de `0.0.0.0`, ou porta do domínio diferente de `PORT` |
| `403 Forbidden` ao salvar transações | `APP_URL` não bate com o domínio de onde a página foi aberta |
| Importação por IA aparece desabilitada na tela | Falta `MODELO_IA` ou `OPENAI_API_KEY` |
| A tela avisa "N linhas do documento não viraram lançamento" | O modelo não devolveu essas linhas nem quando o servidor cobrou. Baixe `LIMITE_LANCAMENTOS_LOTE` ou use um modelo melhor em `MODELO_IA`; o log do container lista as linhas |
| A tela avisa "N linhas não correspondem a lançamentos datados" | O modelo leu totais e resumos da fatura como se fossem compras. Elas já vêm recolhidas e fora das somas; o log do container lista quais são |
| "A resposta da IA foi cortada por tamanho" | O lote pede mais lançamentos do que cabem na resposta: baixe `LIMITE_LANCAMENTOS_LOTE` |
| `PROVEDOR_IA "x" não é suportado` | Só `openai` é aceito hoje |
| "Envio de e-mail não configurado" na troca de e-mail ou na redefinição de senha | Falta `SMTP_HOST` (e as demais `SMTP_*`) |
| E-mail não chega e o log mostra erro de certificado | SMTP interno com certificado autoassinado: use `SMTP_TLS_REJECT_UNAUTHORIZED=false` |
| Link de redefinição de senha aponta para `localhost` | Falta `APP_URL` com o domínio público |
| "A integração não está configurada" no perfil | Faltam `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| `redirect_uri_mismatch` ao conectar a agenda | O URI cadastrado no Google Cloud não é exatamente `APP_URL` + `/api/google/callback` |
| "O Google não devolveu a autorização de longa duração" | A conta já havia autorizado antes; remova o acesso em myaccount.google.com/permissions e conecte de novo |
| Tarefas param de virar compromisso, e o Google Console acusa erro em `Events.Insert` | Alguma tarefa foi recusada pelo Google. O aviso no perfil nomeia qual; corrija as datas dela. As demais continuam subindo |
| A agenda só sincroniza quando alguém abre o app | O agendador vive no processo web. Defina `GOOGLE_SYNC_TOKEN` e chame `POST /api/google/sync` por um cron — veja "Garantir que a sincronização roda" |
| "O armazenamento de arquivos não está configurado" na tarefa | Faltam `S3_BUCKET`, `S3_ACCESS_KEY_ID` ou `S3_SECRET_ACCESS_KEY` |
| "O navegador não conseguiu enviar o arquivo ao armazenamento" | CORS do bucket não libera o domínio do app — veja a seção CORS acima |
| Anexo envia mas não aparece a miniatura | Endpoint acessível pelo servidor mas não pelo navegador, ou `S3_FORCE_PATH_STYLE` errado |

---

## Google Agenda

A conexão é **por usuário**: cada pessoa abre o próprio perfil e autoriza o app
na sua conta Google. A tarefa vira compromisso na agenda de quem é **responsável**
por ela; tarefa sem responsável, ou com responsável que não conectou a conta,
não vira evento.

No Google Cloud Console:

1. Ative a **Google Calendar API** no projeto;
2. Na tela de permissão OAuth, declare o escopo
   `https://www.googleapis.com/auth/calendar.events` (mais `openid` e `email`);
3. Crie uma credencial **ID do cliente OAuth → Aplicativo da Web**;
4. Em *URIs de redirecionamento autorizados*, cadastre exatamente
   `https://SEU-DOMINIO/api/google/callback` — o mesmo host de `APP_URL`.

Enquanto o app estiver como "Em teste" na tela de permissão, só os e-mails
listados como usuários de teste conseguem conectar, e o consentimento expira em
sete dias. Para uso contínuo, publique o app.

**Cota**: a leitura é incremental (`syncToken`), então cada rodada traz só o que
mudou — uma chamada por usuário conectado a cada `GOOGLE_SYNC_INTERVALO_MINUTOS`.
Nos erros de limite (403 de cota, 429) e nas falhas temporárias, a chamada é
repetida com espera crescente, até três vezes.

### Garantir que a sincronização roda

O agendador é um laço dentro do próprio processo web, levantado no primeiro
acesso autenticado depois de o servidor subir. Sem ninguém usando o app ele não
sobe; com mais de uma réplica, cada uma roda o seu. Para não depender disso,
defina `GOOGLE_SYNC_TOKEN` e aponte um cron para a rota:

```bash
curl -fsS -X POST \
  -H "authorization: Bearer $GOOGLE_SYNC_TOKEN" \
  https://SEU-DOMINIO/api/google/sync
```

A resposta é o resumo da rodada em JSON — quantos usuários foram varridos,
quantos eventos foram lidos, quantas datas mudaram, quantas tarefas subiram e
quantas o Google recusou. É também a forma de responder, de fora, se a
sincronização está mesmo acontecendo. Chamar duas vezes ao mesmo tempo é seguro:
a segunda volta com `emAndamento: true` sem fazer nada.

### Quando uma tarefa não vira compromisso

O Google recusa o evento de uma tarefa em particular quando não aceita o que foi
enviado — uma data fora de faixa, por exemplo. Essa tarefa fica registrada na
trilha e sai da fila até ser editada, ou até o dia seguinte, e **as demais
continuam subindo**. O aviso no perfil nomeia a tarefa recusada, e o botão
*Diagnosticar sincronização* lista as últimas recusas com o motivo, quantas
tarefas esperam para subir e há quantos minutos foi a última leitura.

---

## CORS do bucket de anexos

O arquivo vai do navegador **direto** para o bucket, com uma URL que este
servidor assina — nada trafega pelo container, então um vídeo grande não ocupa
memória nem estoura tempo de requisição. Em troca, o bucket precisa aceitar o
domínio do app:

```json
[
  {
    "AllowedOrigins": ["https://financas.seudominio.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

- **AWS S3**: bucket → Permissions → Cross-origin resource sharing (CORS).
- **MinIO**: `mc admin config set` ou a variável de CORS do serviço.
- **Cloudflare R2**: bucket → Settings → CORS policy.

Mantenha o bucket **privado**. A leitura também é por URL assinada com prazo
(`S3_URL_TTL_SEGUNDOS`), e é assim que imagem, vídeo e PDF aparecem na tarefa —
essas cargas não passam por CORS, só o envio.

Se o envio falhar com "o navegador não conseguiu enviar o arquivo", é CORS: a
resposta do bucket ao *preflight* não liberou o domínio.

---

## Nota sobre a Lovable

O projeto continua conectado à Lovable, que faz o próprio build para Cloudflare
Workers. O `NITRO_PRESET=node-server` definido no `Dockerfile` vale só para o
build em container — dentro do ambiente da Lovable essa variável é ignorada, e
o editor segue funcionando normalmente. Os dois deploys convivem sem conflito.
