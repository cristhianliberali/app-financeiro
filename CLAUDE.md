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
que a pessoa escreveu, e a mitigação é o cartão de revisão editável.

Ver `docs/chat-ia.md`. Configuração: `GROQ_API_KEY` e `MODELO_IA_CHAT`
(`.env.example`, seção *Chat com IA*).
