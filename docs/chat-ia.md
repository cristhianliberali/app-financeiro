# Chat com IA (assistente do Finanças)

O botão **Assistente**, no cabeçalho do módulo Finanças, abre uma gaveta onde a
pessoa escreve em português o que quer consultar ou lançar:

- *"Quanto gastei este mês em alimentação?"* → **Você gastou R$ 100,00 do seu
  teto de R$ 350,00 em Alimentação, em setembro de 2026. Ainda cabem R$ 250,00
  no período.**
- *"Gastei 158 no mercado"* → um **rascunho** de lançamento, editável, que só
  vira transação quando a pessoa clica em Confirmar.

## A regra que organiza tudo

> A IA nunca escreve no banco. Ela devolve **intenção**; quem consulta, calcula
> e grava é o código, e o registro só acontece depois da confirmação.

Isso não é uma política de uso: é a forma do código. Não existe caminho entre a
resposta do modelo e um `INSERT`. O que o modelo devolve é um JSON de intenção
que passa por um validador estrito (`parseIntent`) e, dali, ou vira uma consulta
SQL, ou vira um objeto de rascunho que a tela mostra. O botão Confirmar chama o
mesmo `upsertRows` do formulário manual — com as mesmas checagens de permissão e
a mesma exigência de categoria no servidor.

Três consequências práticas:

1. **Nenhum número da resposta passa pelo modelo.** "Você gastou R$ 100,00" é
   `SUM(amount)` no Postgres, e a frase é montada por `resumoConsulta`. Se o
   modelo alucinar um total, ele não tem por onde publicá-lo.
2. **Nenhuma data é calculada pelo modelo.** Ele devolve `{"tipo":"mes_anterior"}`
   ou `{"tipo":"ontem"}`; quem vira isso em `2025-12-01` a `2025-12-31` é
   `resolvePeriodo`/`resolveData`, testados na virada de mês e de ano.
3. **A categoria é casada com o perfil, não inventada.** O modelo escreve um
   nome; `casarCategoria` procura a categoria correspondente na subconta. Sem
   correspondência, o rascunho chega sem categoria e a tela exige que a pessoa
   escolha uma antes de confirmar.

A única coisa que o modelo de fato transcreve é o **valor de um lançamento
novo** — ele sai do texto que a pessoa acabou de escrever, e não há de onde mais
tirá-lo. A mitigação é o fluxo: o valor aparece por extenso no cartão de
revisão, editável, antes de qualquer gravação.

## Camadas

```
frase da pessoa
  └─ chat.server.ts     monta o prompt com as categorias da subconta
     └─ groq.server.ts  chamada HTTP ao provedor (modo JSON)
        └─ parseIntent  valida contra o contrato; o que não bate é recusado
           ├─ consulta.server.ts   SUM no banco -> ConsultaResult -> frase
           └─ montarRascunho       proposta editável; nada é gravado
                                   └─ [confirmação] -> upsertRows
```

| Arquivo | Papel |
| --- | --- |
| `src/lib/chat-contract.ts` | Tipos, validador, resolução de datas e a frase da resposta. Puro e testado. |
| `src/integrations/ai/chat/prompt.ts` | O prompt e o contrato de saída. Puro. |
| `src/integrations/ai/chat/groq.server.ts` | A chamada HTTP e a tradução dos erros do provedor. |
| `src/integrations/ai/chat/categorias.ts` | Casamento de nome de categoria com a subconta. Puro e testado. |
| `src/integrations/ai/chat/consulta.server.ts` | A consulta agregada no Postgres. |
| `src/integrations/ai/chat/chat.server.ts` | Orquestração das etapas acima. |
| `src/lib/chat.functions.ts` | As duas server functions (`getChatConfig`, `sendChatMessage`). |
| `src/lib/chat.ts` | Hooks da tela, incluindo a gravação do rascunho confirmado. |
| `src/components/chat/` | A gaveta, o cartão de consulta e o cartão de confirmação. |

## O que o assistente sabe fazer

**Consultar** gastos, entradas e saldo, com ou sem categoria. O período é
obrigatório no contrato; quando a pessoa não diz nada, o modelo é instruído a
devolver `mes_atual`, e é isso que responde. Categoria arquivada entra na
consulta (o histórico continua valendo).

**Registrar** um lançamento único ou parcelado. Categoria e data são
obrigatórias: sem data informada vale hoje, e sem categoria reconhecida a tela
pede uma. Sem "já paguei" na frase, o lançamento nasce **em aberto** — dar baixa
depois custa um clique, e desfazer uma baixa errada custa encontrar o lançamento
de novo. Uma compra parcelada usa o mesmo `buildInstallments` do formulário
manual: mesma divisão de centavos, mesmo padrão de nome `DESCRIÇÃO k/n`, mesmo
grupo de parcelas.

O que ele **não** faz: apagar, editar ou dar baixa em lançamento existente.
Esses pedidos caem na ação `conversar`, que explica onde fazer isso na tela. É
deliberado — a IA propõe criação, e destruição não se propõe por conversa.

## Configuração

Tudo em `.env.example`, na seção *Chat com IA*. O mínimo é `GROQ_API_KEY`
(gratuita em https://console.groq.com/keys); sem ela o botão não aparece e o
resto do app segue igual.

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `GROQ_API_KEY` | — | **Segredo.** Sem ela o recurso fica indisponível. |
| `MODELO_IA_CHAT` | `llama-3.3-70b-versatile` | Modelo, como a Groq o nomeia. |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Aponta para qualquer serviço compatível com `/chat/completions`. |
| `CHAT_IA_HISTORICO` | `6` | Mensagens anteriores enviadas junto. |
| `CHAT_IA_MAX_TOKENS` | `800` | Trava de tamanho da resposta. |
| `PROVEDOR_IA_CHAT` | `groq` | Existe para quando houver um segundo provedor. |

É configuração separada da importação de faturas (`PROVEDOR_IA`, `MODELO_IA`,
`OPENAI_API_KEY`) de propósito: são dois trabalhos diferentes — um lê documentos
inteiros, o outro interpreta uma frase curta e precisa responder na hora.

O log obedece às mesmas variáveis `LOG_IA*` do resto da IA: com `LOG_IA=true`,
cada mensagem deixa no log do container o prompt enviado e o JSON devolvido.

### Modo JSON, e não JSON Schema

A chamada usa `response_format: {"type":"json_object"}`, que toda a linha da Groq
aceita, e não um JSON Schema estrito, que só alguns modelos aceitam — assim
trocar `MODELO_IA_CHAT` não quebra o recurso. A garantia de formato não vem do
provedor de qualquer jeito: vem do `parseIntent`, que roda depois e recusa o que
não bate com o contrato. Resposta fora do contrato vira "não entendi, reescreva"
— nunca um palpite.

## Testes

```
bun test test/chat
```

Cobrem o validador do contrato (incluindo o que ele precisa **recusar**), a
resolução de datas nas viradas de mês e ano, o rateio do teto por período, as
frases de resposta, o casamento de categorias e a tradução dos erros do provedor
(cota estourada, chave recusada, modelo inexistente). Nenhum deles chama a API.
