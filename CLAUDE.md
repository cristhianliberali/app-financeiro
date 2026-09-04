# Notas para trabalho assistido neste repositório

App de finanças pessoais em TanStack Start (React 19 + Vite) sobre Bun, com
Postgres. Comandos: `bun run dev`, `bun run typecheck`, `bun run lint`,
`bun test`.

## Pipeline de extração de documentos financeiros

Regra arquitetural inviolável: o LLM nunca transcreve dados do documento.
Valores, datas e descrições vêm sempre do parser determinístico.
O LLM recebe linhas numeradas e devolve apenas `id:classificacao`.

Camadas (ver `docs/pipeline-extracao.md`):

1. Ingestão canônica — arquivo -> lista de Linha(id, pagina, bbox, texto)
2. Tipagem — regras genéricas, sem conhecimento de emissor
3. Classificação — LLM em blocos, contrato de contagem
4. Reconciliação — checksums declarados no próprio documento
5. Quarentena — nada abaixo do limiar entra no banco sem revisão

Nunca adicione lógica específica de banco (Sicoob, Itaú, Nubank) nas camadas 1 e 2.

Se uma decisão de design fizer o LLM emitir um valor, uma data ou uma descrição,
essa decisão está errada. Alucinação de valor não é mitigada aqui — ela é
estruturalmente impossível, porque o modelo não tem canal de saída para um número.

### Decisão de linguagem (Fase 0)

O pipeline fica **em TypeScript, dentro deste repositório**, em
`src/integrations/ai/pipeline/`. O guia recomenda isolar as camadas 1 e 2 num
serviço Python (`pdfplumber`); aqui isso foi descartado por restrição
operacional real:

- o app roda como **um único container** (Dockerfile na raiz, deploy EasyPanel);
  um sidecar Python duplicaria imagem, deploy, healthcheck e segredos;
- o repositório é **conectado ao Lovable**, que sincroniza este repo — um
  segundo serviço ficaria fora desse fluxo;
- `unpdf` (pdf.js) **já é dependência** e expõe `getTextContent()` com a matriz
  de transformação de cada item, que é geometria suficiente para agrupar linhas
  por tolerância vertical e produzir `bbox`.

O custo dessa escolha é o agrupamento manual de caracteres em linhas, que fica
isolado em `canonical.server.ts` e coberto por teste. Se um dia OCR entrar no
caminho principal, reabra a decisão: aí a conta muda.

### Pipeline antigo

`src/integrations/ai/{import,openai,coverage,tokens,extract,amounts,cache}.server.ts`
é a importação em produção hoje, em que o modelo **transcreve** os lançamentos e
o servidor confere depois. O pipeline novo convive com ele em
`src/integrations/ai/pipeline/` e não altera nenhum desses arquivos.

## Chat de IA (assistente do Finanças)

Vive em `src/integrations/ai/chat/` + `src/lib/chat-contract.ts`, e é
independente dos dois pipelines de importação acima.

Regra arquitetural inviolável, irmã da do pipeline de extração: **o LLM devolve
intenção, nunca resultado**. Ele diz "consultar gastos de Alimentação no mês
passado"; o número vem de um `SUM` no Postgres, a data vem de
`resolvePeriodo`/`resolveData`, a frase vem de `resumoConsulta`, e a categoria
vem de `casarCategoria` contra as categorias reais do perfil.

A IA não escreve no banco. Não existe caminho da resposta do modelo até um
`INSERT`: um registro vira rascunho, a tela mostra para revisão, e o botão
Confirmar chama o mesmo `upsertRows` do formulário manual.

Se uma decisão de design fizer o chat responder um número que o modelo escreveu,
ou gravar algo sem passar pela confirmação, essa decisão está errada.

A única transcrição aceita é o valor de um lançamento novo — ele nasce no texto
que a pessoa escreveu (ou na foto do comprovante), e a mitigação é o cartão de
revisão editável.

Imagem e áudio entram por uma etapa a mais, sempre **antes** da interpretação:
o anexo vira texto numa requisição própria (`MODELO_IA_VISAO` para imagem,
`MODELO_IA_AUDIO` para áudio) e esse texto segue para o modelo de chat com o
contrato de sempre. A etapa de visão **transcreve e nada mais** — não escolhe
categoria, não decide entrada/saída, não calcula data, não responde consulta.
Se ela passar a classificar, existirão dois lugares decidindo o que é um
lançamento, e o de imagem é o menos testável dos dois.

O texto extraído da imagem fica visível na tela, discreto, junto da resposta: é
o que permite saber se um lançamento estranho veio de leitura errada do papel ou
de interpretação errada do pedido.

Ver `docs/chat-ia.md`. Configuração: `GROQ_API_KEY` e `MODELO_IA_CHAT`
(`.env.example`, seção *Chat com IA*).

## Assinaturas (Cakto) e acesso ao app

Vive em `src/integrations/cakto/` + `src/lib/plano.ts`, com a trava em
`requirePlano` (`src/integrations/postgres/auth-middleware.ts`).

Regra arquitetural inviolável, irmã das duas acima: **a Cakto decide o estado da
assinatura; o app decide o que esse estado libera** — e essa decisão nunca é uma
chamada de rede. O status chega por webhook, é normalizado e gravado em
`app_users.status_plano`; o acesso é uma leitura de coluna, no login e em cada
requisição de dado.

Se o acesso passar a depender de perguntar à Cakto na hora, uma instabilidade
dela vira um app fora do ar, com todo mundo trancado para fora dos próprios
dados. É por isso que a API pública (`api.server.ts`) só serve para o teste de
conexão do painel, e nada no caminho do login a atravessa.

Duas consequências disso, que também não se negociam:

- **o corpo cru de todo webhook é gravado em `cakto_webhook_events` antes de ser
  interpretado.** Essa tabela não é log, é a fonte da verdade sobre o que a
  Cakto mandou: mapeamento errado se corrige e reprocessa (`aplicarEvento`), sem
  depender de reenvio;
- **na dúvida não se chuta.** Evento desconhecido cuja intenção não dá para
  deduzir fica `ignorado` e aparece no painel; status desconhecido vira
  `sem_assinatura`, que não libera. Nem liberar nem bloquear por adivinhação.

`contrato.ts` é tolerante de propósito (procura cada campo numa lista de
caminhos plausíveis) porque documentação de gateway envelhece — e aqui não foi
hipótese: os payloads reais mandam `data` como **lista**, onde a documentação
descreve um objeto. As fixtures em `test/fixtures/cakto/` são capturas de
verdade e existem para travar isso.

Delas sai a regra assimétrica que **não se inverte**: só o nome do evento libera
acesso; o campo `status` do corpo só pode restringir. No `chargeback` real,
`data[0].status` vale `"paid"` e `subscription.status` vale `"active"` — confiar
neles daria acesso a quem acabou de contestar a cobrança. E no `purchase_approved`
real, `subscription.status` vale `"inactive"` numa compra aprovada. Os dois
campos descrevem o pedido, não a assinatura.

A tolerância para na conferência do segredo e na decisão de acesso — ali,
adivinhar é o erro.

**A entrega do acesso roda em `subscription_created`, e em nenhum outro evento.**
Uma compra dispara também `purchase_approved` com o mesmo `data[0].id`;
provisionar nos dois mandaria duas senhas diferentes para a mesma pessoa. A
renovação não provisiona pelo motivo inverso — quem renova já escolheu a própria
senha. Quem muda isso precisa responder antes: qual das senhas a pessoa usa?

Duas travas em volta disso, ambas com motivo concreto:
`acesso_provisionado_em` impede que *Reprocessar* vire uma enxurrada de senhas
(a saída para o e-mail que não saiu é *Reenviar acesso*, no painel), e super
admin nunca tem a senha trocada por webhook — testar a própria compra não pode
custar o painel.

Esconder botão na tela não é trava: server function é endpoint HTTP. Toda função
que lê ou escreve dado financeiro ou de tarefa passa por `requirePlano`; ficam
fora, de propósito, entrar, sair, o próprio cadastro e a tela de assinatura.

Ver `docs/cakto-assinaturas.md`. Configuração: `CAKTO_WEBHOOK_SECRET`,
`CAKTO_EXIGIR_ASSINATURA` e `SUPER_ADMIN_EMAILS` (`.env.example`, seções
*Assinaturas (Cakto)* e *Super admin*).
