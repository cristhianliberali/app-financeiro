# Pipeline de extração de documentos financeiros

Extração de faturas e extratos em cinco camadas, em
`src/integrations/ai/pipeline/`. Ainda não está ligado à tela: convive com a
importação atual (`src/integrations/ai/import.server.ts`) para poder ser medido
contra ela antes de substituí-la.

## Princípio

**O modelo de linguagem nunca carrega o dado. Ele só decide sobre o dado.**

Todo valor monetário, data, descrição e identificador que chega ao banco vem de
extração determinística sobre o arquivo. O LLM recebe linhas já numeradas e
devolve apenas classificações referenciando esses números — `id:tipo,categoria,confiança`.
Ele não tem canal de saída por onde emitir um número, então alucinação de valor
não é uma classe de erro possível.

### Corolários

| Regra | Motivo |
|---|---|
| Toda linha recebe um `id` estável antes de qualquer processamento | Permite verificar completude por igualdade de conjuntos |
| Nenhuma etapa descarta linha silenciosamente | Linha não classificada vira `AMBIGUA`, nunca lixo |
| O LLM é chamado em blocos pequenos e sem estado | Elimina a condição para "esquecer" no meio de uma lista longa |
| Completude é diferença de conjuntos, não heurística | `enviados − recebidos` é booleano, não é score |
| Reconciliação confirma tipagem; não detecta omissão | Omissão já foi eliminada na camada de blocos |

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

- **Convenção numérica por documento**, decidida por votação sobre todos os
  valores encontrados, com **exigência de unanimidade**. A fatura de referência é
  brasileira e imprime `R$ 6,598.58` (padrão americano); um parser fixado em
  pt-BR leria R$ 6,59. Convenção mista levanta erro — é sinal de erro de
  extração, não de documento exótico.
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

O **cache de merchants** é consultado *antes* de montar os blocos, com chave no
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

Mais os validadores de sanidade semântica, plugáveis: data fora do período,
valor fora da faixa, convenção decimal não uniforme, contagem de lançamentos
fora da faixa histórica.

## Camada 5 — Quarentena (`quarantine.ts`)

```
recebido → canonizado → tipado → classificado → reconciliado → confirmado
                                      ↓
                                 quarentena → confirmado
```

Nada entra na tabela de transações antes de `confirmado`. Gatilhos: confiança
abaixo do limiar, reconciliação que não fechou, divergência em linha de
sobreposição, `AMBIGUA` que o LLM também não resolveu, sanidade violada.

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
Anuidade/encargos fora dos portadores: 36.00
Total geral declarado: 6,598.58
```

## Armadilhas cobertas por teste

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
