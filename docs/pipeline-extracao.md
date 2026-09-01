# Pipeline de extração de documentos financeiros

Extração de faturas e extratos em cinco camadas, em
`src/integrations/ai/pipeline/`. Ainda não está ligado à tela: convive com a
importação atual (`src/integrations/ai/import.server.ts`) para poder ser medido
contra ela antes de substituí-la.

```
canonical.server.ts   camada 1 — arquivo -> linhas numeradas com bbox
typing.ts             camada 2 — tipagem determinística
blocks.ts             camada 3 — divisão em blocos e paralelismo
classify.server.ts    camada 3 — protocolo, contrato de contagem, retry
merchants.server.ts   camada 3 — cache de merchants
provider.server.ts    camada 3 — abstração de provedor de LLM
reconcile.ts          camada 4 — checksums e sanidade semântica
quarantine.ts         camada 5 — estados, gatilhos e revisão
pipeline.server.ts    as cinco camadas em ordem
```

Rodar a suíte: `bun test`. Nenhum teste chama API de LLM — a camada 3 recebe um
cliente falso pela interface `LlmClient`.

## O fluxo na tela: duas etapas

A importação no app acontece em duas etapas, e a primeira não usa IA nenhuma:

1. **Ler documento** — `extracao.server.ts` roda as camadas 1, 2 e 4 e a tela
   (`DocumentImportPanel`, em `/importar`) mostra tudo de uma vez: as transações
   na ordem do documento, agrupadas por portador/seção, a conferência de cada
   total declarado, e as linhas não interpretadas. O usuário confere, ajusta e
   pode lançar direto, com categoria manual — que é obrigatória para lançar.
   A revisão em aberto fica guardada no `localStorage` do navegador: sair da
   tela e voltar não custa a leitura, e só o botão "Limpar" a descarta.
2. **Categorizar com IA** (botão na barra de ação) — só então a IA entra
   (`categorize.server.ts`): as descrições numeradas e as categorias
   disponíveis vão para o modelo, que devolve `id:codigo,confiança`. O arquivo
   nunca é enviado. Gasto e entrada rodam separados, cada um só com as
   categorias do próprio tipo — uma compra não tem como receber categoria de
   receita, porque o código dela nem está no enum daquela rodada. O contrato de
   contagem da camada 3 vale igual: id sem decisão volta sozinho, id inventado
   é descartado, e a categorização não termina incompleta.

   O cache de merchants mora na tabela `merchant_labels` (global, chave no
   descritor cru, rótulo no **nome** da categoria — id é por perfil, nome viaja
   entre perfis). Merchant conhecido nem vira requisição, cada decisão nova do
   modelo alimenta o cache, e **cada lançamento confirmado pelo usuário grava
   rótulo com peso de gente**, que a IA não sobrescreve. Requer
   `bun run db:migrate` para criar a tabela, e `MODELO_IA`/`OPENAI_API_KEY` no
   ambiente — sem elas o botão fica desativado e a etapa 1 segue funcionando.

O diálogo antigo (`AiImportDialog`, que manda o texto inteiro para o modelo
transcrever) continua no repositório para comparação, mas a tela de transações
abre o novo.

## Princípio

**O modelo de linguagem nunca carrega o dado. Ele só decide sobre o dado.**

Todo valor monetário, data, descrição e identificador que chega ao banco vem de
extração determinística sobre o arquivo. O LLM recebe linhas já numeradas e
devolve apenas classificações referenciando esses números — `id:tipo,categoria,confiança`.
Ele não tem canal de saída por onde emitir um número, então alucinação de valor
não é uma classe de erro possível.

### Corolários

| Regra                                                             | Motivo                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Toda linha recebe um `id` estável antes de qualquer processamento | Permite verificar completude por igualdade de conjuntos       |
| Nenhuma etapa descarta linha silenciosamente                      | Linha não classificada vira `AMBIGUA`, nunca lixo             |
| O LLM é chamado em blocos pequenos e sem estado                   | Elimina a condição para "esquecer" no meio de uma lista longa |
| Completude é diferença de conjuntos, não heurística               | `enviados − recebidos` é booleano, não é score                |
| Reconciliação confirma tipagem; não detecta omissão               | Omissão já foi eliminada na camada de blocos                  |

## Camada 1 — Ingestão canônica (`canonical.server.ts`)

Qualquer entrada vira a mesma estrutura. Esta camada não interpreta nada: ela
numera.

```ts
type Linha = {
  id: number;                                     // sequencial, ordem de leitura
  pagina: number;
  bbox: [number, number, number, number] | null;  // x0, y0, x1, y1
  texto: string;                                  // cru, espaçamento preservado
  origem: "pdf_texto" | "ocr" | "csv" | "ofx" | "texto";
};

type DocumentoCanonico = {
  linhas: Linha[];
  metadados: { hash: string; nPaginas: number; producer, creator, ... };
  origem: string;
};
```

`bbox` é o que permite mostrar ao usuário de onde veio cada número, recortado do
PDF original, na revisão da camada 5. Sem geometria (CSV, OFX, texto colado) é
`null`.

Adaptadores: PDF com camada de texto (`unpdf`/pdf.js, agrupando itens por
tolerância vertical), CSV, OFX e texto. PDF escaneado é **detectado** por
densidade de caracteres por página e levanta `OcrNecessarioError` — OCR ainda
não está implementado.

Lossless por definição: reprocessar o mesmo arquivo produz exatamente os mesmos
IDs, e nenhuma linha é filtrada ou normalizada.

## Camada 2 — Tipagem determinística (`typing.ts`)

Classifica o máximo possível sem LLM e **sem qualquer conhecimento de emissor**.
Uma linha com data + valor + texto no meio é um lançamento em qualquer fatura do
mundo; esse é o nível de generalidade a manter.

```
LANCAMENTO | TOTAL_DECLARADO | CABECALHO | MARCADOR_GRUPO | RUIDO | AMBIGUA
```

- **Convenção numérica por documento**, decidida por votação em que só dinheiro
  vota e a evidência mais forte decide. A fatura de referência é brasileira e
  imprime `R$ 6,598.58` (padrão americano); um parser fixado em pt-BR leria
  R$ 6,59. Três níveis de evidência: valor com milhar e centavos (`1.690,11`),
  decimal solto (`29,90`) e número só agrupado (`14.181`). Não votam: número sem
  dois dígitos de centavos (`2.0` de rodapé — caso real que derrubava a leitura),
  taxa (`2,38%`) e moeda estrangeira (`US$ 25.90`). Dois valores **com milhar**
  em convenções opostas seguem levantando erro — isso é extração quebrada; um
  decimal solto contra a evidência forte vira alerta de sanidade na camada 4, e
  o valor ainda é lido pelo último separador, do jeito que está escrito.
- **Resolução de ano**: mês da linha ≤ mês de fechamento → ano do fechamento;
  maior → ano anterior. `dataRaw` é sempre preservada ao lado de `dataIso`.
- **Parcela `NN/NN`** sai da descrição por regex antes de qualquer LLM.
- **Estorno** tem flag própria, não só sinal no número.

Invariante: a soma das linhas por tipo é igual ao total de linhas do documento
canônico.

## Camada 3 — Classificação por LLM (`blocks.ts`, `classify.server.ts`)

Blocos de 20–30 linhas, com **2 linhas de sobreposição** entre blocos
consecutivos. Entrada: linhas numeradas, texto cru. Saída: uma decisão por
linha, `id:tipo,categoria,confiança`. Nunca JSON aninhado — repetir nome de
campo custa token e dá mais erro de formatação.

Contrato de contagem, verificado por diferença de conjuntos:

```
faltando = enviados − recebidos   → reenvia só os IDs faltantes, isoladamente
extras   = recebidos − enviados   → descarta e registra como sinal de qualidade
```

Nenhum caminho de código deixa o pipeline avançar com `faltando` não vazio.

Blocos são independentes e sem estado, então rodam em paralelo com limite de
concorrência, e a falha de um é retentável sozinha. Linhas de fronteira são
julgadas duas vezes; divergência marca a linha para revisão.

O **cache de merchants** é consultado _antes_ de montar os blocos, com chave no
descritor cru normalizado (`VIPI SUPERMERCADOS E`), global e não por usuário. Só
merchant inédito entra na chamada.

Trocar de modelo é mudança de config: o provedor é uma interface
(`LlmClient`), e os testes usam cliente mockado — nenhum teste chama API real.

## Camada 4 — Reconciliação (`reconcile.ts`)

Confirma que a **tipagem** está correta; não é o detector de omissão. Todo
documento financeiro carrega os próprios checksums: existe um total, e as linhas
têm que somar nele.

1. Colete os `TOTAL_DECLARADO` da camada 2
2. Colete os lançamentos por grupo (`MARCADOR_GRUPO`)
3. Procure subconjuntos que somem exatamente cada total declarado — grupos
   primeiro, busca genérica só depois, para não explodir a complexidade
4. Nenhum total fecha → tipagem errada em algum lugar

Cada total é procurado do sinal mais forte para o mais fraco, e a via fica no
relatório em vez de virar um "fechou" indistinto:

| Via          | O que bateu                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `grupo`      | as linhas do próprio bloco somam o subtotal dele                                                                  |
| `subtotais`  | um subconjunto dos subtotais que já fecharam                                                                      |
| `identidade` | uma combinação assinada dos outros totais do mesmo bloco — `anterior − pagamentos + encargos + compras = a pagar` |
| `documento`  | a soma de todos os lançamentos                                                                                    |
| `busca`      | um subconjunto qualquer, procurado dentro do bloco do total                                                       |

Mais os validadores de sanidade semântica, plugáveis: data fora do período,
valor fora da faixa, convenção decimal não uniforme, contagem de lançamentos
fora da faixa histórica.

## Camada 5 — Quarentena (`quarantine.ts`)

```
recebido → canonizado → tipado → classificado → reconciliado → confirmado
                                      ↓
                                 quarentena → confirmado
```

Nada entra na tabela de transações antes de `confirmado`: `paraPersistir` é o
único caminho de saída, e levanta erro em qualquer outro estado. Gatilhos:

- `confianca_baixa` — decisão abaixo do limiar (0,8 por padrão)
- `reconciliacao_aberta` — total declarado que não fechou
- `divergencia_de_fronteira` — a mesma linha julgada diferente em dois blocos
- `ambigua_nao_resolvida` — `AMBIGUA` que o LLM também não resolveu
- `sem_valor_deterministico` — o modelo diz que é lançamento, o parser não achou
  valor. É aqui que fica evidente que ele não tem como inventar um número
- `conflito_de_tipo` — o modelo contradisse a tipagem determinística
- `sanidade_violada` — validador da camada 4 apontou a linha
- `lancamento_orfao` — não entrou em nenhum total que fechou

A revisão mostra o trecho cru ancorado no `bbox` — recorte da região do PDF, não
texto reescrito. Cada confirmação vira rótulo: alimenta o cache de merchants e a
suíte dourada.

## Fixture dourada

`test/fixtures/fatura-sicoob.txt` reproduz a fatura de referência, com
separadores no padrão americano. Checksums conhecidos:

```
Identidade do resumo:
  8,165.23 − 8,338.69 + 144.00 + 6,628.04 = 6,598.58
Totais por portador:
  110.00   (final 6567)
  435.47   (final 9661)
  6,017.11 (final 5249)
Movimentações fora dos portadores: 65.46 (anuidade 36.00 + seguro 29.46)
Compras do período: 110.00 + 435.47 + 6,017.11 + 65.46 = 6,628.04
Total geral declarado: 6,598.58
```

Os nove totais da fixture fecham e nenhum lançamento fica órfão. Remover uma
linha derruba o subtotal do portador dela pela diferença exata e deixa os
lançamentos daquele bloco órfãos — é esse o teste que protege a refatoração.

## Armadilhas cobertas por teste

Da fatura real de referência (7 páginas, layout Sicoob 2026):

8. **Duas colunas de lançamentos lado a lado** — agrupar só por altura cola a
   data de um lançamento no valor do outro e some com metade da coluna
   esquerda. A camada 1 procura o corredor vertical vazio e só divide quando os
   dois lados têm lançamentos completos (data + valor); a coluna de valores de
   uma tabela comum não passa nesse teste.
9. **Nome do lançamento na linha de cima** — "ANUIDADE MASTERCARD" em cima,
   "04 MAI … R$ 72,00" embaixo, "(5249) 03/12" embaixo ainda. A camada 2
   detecta a coluna de descrição em branco (pelo alinhamento típico do
   documento) e absorve nome e cauda; nome quebrado em conectivo ("PROTEÇÃO
   PERDA OU" / "ROUBO") junta as duas linhas.
10. **Sobra de parcela em linha própria** — um "01/02" solto não rouba o valor
    do lançamento de baixo: continuação exige descrição na linha da data.
11. **CNPJ que parece data** — "02.038.232/0001-64" na linha do boleto virava
    lançamento do valor da fatura inteira; a data inicial agora exige fronteira
    à direita.
12. **Vencimento e período por extenso** — "VENCIMENTO 11 AGO 2026" e
    "REF 1 JUL A 1 AGO" saem das linhas que os anunciam; as compras de uma
    fatura acontecem antes das datas administrativas que ela imprime.
13. **Total declarado ≠ total conferível** — limite, taxa, pagamento mínimo e
    dívida futura são declarações, não somas das linhas; só rótulos de TOTAL
    (fora desses contextos) entram no veredito da conferência.

14. **Extrato marca sentido com letra** — "1.234,56 D" / "1.234,56 C". Quando
    o documento usa as letras com recorrência, o sinal é do banco (débito é
    gasto) e a leitura de fatura (negativo = estorno) não se aplica.
15. **Período numérico sem ano** — "Período: 05/07 a 04/08", resolvido contra o
    fechamento como qualquer data de lançamento.

Para testar a fatura de um banco novo: `bun run extrair caminho/arquivo.pdf`
imprime no terminal exatamente o que a tela mostraria — transações, conferência
e linhas não interpretadas. O que sair errado vira fixture anonimizada e
correção genérica, nunca código de banco.

Da fatura sintética original:

1. Separadores invertidos — `R$ 6,598.58` em documento brasileiro
2. Datas sem ano — resolvidas pelo período, com regra de virada
3. Parcela `NN/NN` colada na descrição — não é data
4. Estornos — negativo no mesmo dia, com flag e pareamento
5. Múltiplos portadores — cada bloco com seu subtotal
6. Movimentações de conta ≠ compras — anuidade e pagamento não são gasto por categoria
7. Compras antigas parceladas — `17 JUL`, `08 JUN` são de anos anteriores

## Fora de escopo por enquanto

Registro de templates/fingerprint, roteamento por similaridade, modelo local.
São otimização de custo, não de corretude. Reintroduzir só com métrica de
produção mostrando que custo ou latência são problema real.
