# Assinaturas na Cakto e área de super admin

O acesso ao app é condicionado ao estado do plano de cada pessoa. Quem define
esse estado é a Cakto, por webhook; o app guarda o resultado já normalizado em
`app_users.status_plano` e decide o acesso lendo essa coluna.

## A regra que sustenta o desenho

**A Cakto decide o estado da assinatura; o app decide o que esse estado libera.**

Disso saem três consequências que valem mais do que qualquer detalhe de campo:

1. **A decisão de acesso nunca é uma chamada de rede.** Ela é uma leitura de
   coluna, no login e em cada requisição de dado. Um gateway fora do ar não pode
   virar um app fora do ar — se o acesso dependesse de perguntar à Cakto, uma
   instabilidade dela trancaria todo mundo para fora dos próprios dados.
2. **O corpo cru de todo webhook é guardado antes de ser interpretado**, em
   `cakto_webhook_events`. Essa tabela não é log: é a fonte da verdade sobre o
   que a Cakto realmente mandou. Se a leitura estiver errada, corrige-se o mapa
   e reprocessa-se o evento guardado, sem pedir reenvio a ninguém.
3. **Na dúvida, não se chuta.** Evento desconhecido cuja intenção não dá para
   deduzir fica gravado como `ignorado` e aparece no painel para alguém olhar.
   Nenhum acesso muda por adivinhação — nem para liberar, nem para bloquear.

## As peças

| Arquivo | O que faz |
| --- | --- |
| `src/lib/plano.ts` | Vocabulário de status e a regra que libera. Puro, roda nos dois lados. |
| `src/integrations/cakto/contrato.ts` | Traduz o corpo do webhook para esse vocabulário. Puro. |
| `src/integrations/cakto/webhook.server.ts` | Guarda o corpo cru e aplica o efeito. |
| `src/integrations/cakto/api.server.ts` | Cliente da API pública (opcional; só o teste de conexão). |
| `src/integrations/postgres/plano.server.ts` | Único lugar que escreve `status_plano`. |
| `src/routes/api/cakto/webhook.ts` | O endpoint que a Cakto chama. |
| `src/routes/admin/` | Painel do super admin. |
| `src/routes/assinatura.tsx` | A tela de quem está logado e sem acesso. |

## Vocabulário de status

| Status | Libera? | Quando acontece |
| --- | --- | --- |
| `ativo` | sim | compra aprovada, assinatura criada ou renovada |
| `trial` | sim | período de teste da oferta |
| `cortesia` | sim | liberado na mão por um super admin |
| `atrasado` | **por 3 dias** | renovação recusada — a Cakto ainda tenta de novo |
| `pausado` | não | assinatura pausada (`subscription_paused`) |
| `cancelado` | não | assinatura encerrada |
| `reembolsado` | não | compra devolvida |
| `chargeback` | não | contestada no cartão |
| `sem_assinatura` | não | nunca comprou — o estado de quem acabou de se cadastrar |

Além do status, `plano_expira_em` encurta o acesso: passado o prazo (mais
`CAKTO_TOLERANCIA_DIAS`), bloqueia mesmo com status liberado. O contrário não
vale — data futura não ressuscita um `cancelado`.

`atrasado` tem regra própria, e é a única exceção ao "status ruim bloqueia na
hora". Os webhooks reais trazem a política de cobrança da Cakto no próprio
corpo — `max_retries: 3` com `retry_interval: 1` —, então uma recusa dá início a
três tentativas em três dias. O acesso sobrevive a essa janela
(`CAKTO_DIAS_CARENCIA`), contada a partir de quando a recusa chegou. Cortar na
primeira falha tiraria o app de quem paga no dia seguinte, e geraria justamente
o suporte que a retentativa existe para evitar.

Quem decide é sempre `avaliarPlano()` em `src/lib/plano.ts`, nunca uma
comparação de string espalhada pelas telas.

## Colunas em `app_users`

As duas pedidas, mais o que a operação exigiu:

- `status_plano` — o estado acima.
- `codigo_oferta` — identificador da oferta comprada na Cakto. É ele que diz
  *qual* plano a pessoa tem: dois assinantes `ativo` podem estar em ofertas
  diferentes. Use-o para liberar funcionalidades por plano.
- `plano_expira_em`, `plano_origem`, `plano_atualizado_em`, `plano_observacao`
- `cakto_customer_id`, `cakto_subscription_id` — para reconciliar e para achar
  a pessoa quando o e-mail da compra não é o do cadastro.
- `is_super_admin`

E duas tabelas novas: `plano_historico` (toda mudança, com autor e motivo) e
`cakto_webhook_events` (todo corpo recebido).

### Liberando funcionalidade por oferta

`codigo_oferta` está no retorno de `getAcesso()`, então uma tela pode fazer:

```tsx
const { data: acesso } = useAcesso();
if (acesso?.codigoOferta === OFERTA_PRO) { /* … */ }
```

Para valer de verdade, a mesma checagem tem que existir no servidor, dentro da
server function correspondente — a tela esconde, ela não protege.

## Instalação

1. **Aplique o schema.** `bun run db:migrate` (idempotente; só adiciona colunas
   e tabelas). Confira com `bun run db:check`.

2. **Configure o segredo.** No painel da Cakto, crie um webhook apontando para
   `https://SEU-DOMINIO/api/cakto/webhook` e marque todos os eventos. Os oito
   já observados nesta conta são `purchase_approved`, `subscription_created`,
   `subscription_renewal_refused`, `subscription_paused`,
   `subscription_resumed`, `subscription_canceled`, `refund` e `chargeback`.
   Copie o segredo para `CAKTO_WEBHOOK_SECRET` no serviço e reinicie o
   container.

3. **Defina o primeiro super admin.** Ponha seu e-mail em `SUPER_ADMIN_EMAILS`
   e abra `/admin`. A conta é marcada no banco no primeiro acesso; dali em
   diante dá para promover outras pessoas pela própria tela.

4. **Confira antes de trancar.** Faça uma compra de teste e abra
   *Eventos da Cakto* no painel: o evento tem que aparecer como `aplicado`, com
   o e-mail certo e o código da oferta. Se aparecer `ignorado`, o nome do evento
   não está no mapa de `contrato.ts` — o corpo cru está ali na tela para você
   ver o que veio.

5. **Ligue a trava.** Só quando os números do painel baterem com a realidade:
   `CAKTO_EXIGIR_ASSINATURA=true`.

O passo 5 é separado de propósito. Subir uma versão que fecha o app antes de a
Cakto estar cadastrando os status trancaria os usuários existentes para fora
dos próprios dados. Com a trava desligada nada mais muda: os webhooks continuam
sendo recebidos e gravados, e o painel continua funcionando.

## Onde a trava está de verdade

No middleware `requirePlano` (`src/integrations/postgres/auth-middleware.ts`),
aplicado às server functions de `data`, `tasks`, `chat`, importação, anexos e
Google Agenda. Esconder botões não protege nada: server functions são endpoints
HTTP, e quem já esteve logado sabe o caminho delas.

Continuam abertas a quem está bloqueado: entrar, sair, ver e editar o próprio
cadastro, e consultar a assinatura. Trancar essas seria trancar a pessoa longe
justamente da tela que existe para ela voltar a pagar.

## O que acontece em cada caso

**Compra antes do cadastro.** O webhook chega sem ninguém a quem aplicá-lo e
fica `sem_usuario`. Quando a pessoa se cadastra com aquele e-mail, o cadastro
aplica os eventos pendentes e ela já entra liberada.

**E-mail da compra diferente do cadastro.** O evento fica `sem_usuario` e
aparece no painel. Duas saídas: a pessoa troca o e-mail do cadastro (aí
reprocessar resolve), ou o super admin ajusta o plano na mão.

**Renovação.** Chega `subscription_renewed`, o status vira `ativo` e
`plano_expira_em` avança. A tolerância cobre o intervalo entre a renovação na
Cakto e a chegada do webhook.

**Cancelamento no meio do ciclo.** O status vira `cancelado` na hora. Se você
quiser manter o acesso até o fim do período pago, o caminho é o painel: mude
para `cortesia` com `expira_em` na data final.

**Reentrega do mesmo evento.** O par (evento, id externo) tem índice único —
o segundo é reconhecido como duplicado e não reaplica nada.

**Ajuste manual e depois um evento da Cakto.** O evento ganha: o estado gravado
é sempre o do último a chegar, e o webhook não sabe que alguém mexeu na mão.
Para cortesia permanente, use uma conta sem assinatura ativa na Cakto.

## Diagnóstico

Quase todo "assinei e não liberou" cai em um destes:

1. **O evento não chegou.** Painel → Eventos vazio. Confira no painel da Cakto
   para qual URL o webhook aponta; o botão *Testar conexão* mostra isso sem sair
   do app (precisa de `CAKTO_CLIENT_ID`/`CAKTO_CLIENT_SECRET`).
2. **Chegou e foi recusado.** Log do container com
   `[cakto] webhook recusado: segredo não confere` — `CAKTO_WEBHOOK_SECRET` está
   diferente do painel.
3. **Chegou e ficou `sem_usuario`.** E-mail da compra ≠ e-mail do cadastro.
4. **Chegou e ficou `ignorado`.** Nome de evento fora do mapa. Abra o corpo cru
   na tela, acrescente o nome em `EVENTO_PARA_STATUS` (`contrato.ts`) e clique
   em *Reprocessar*.

## O corpo real do webhook

Vale registrar, porque a documentação e a realidade divergem em pontos que
custam caro. As fixtures em `test/fixtures/cakto/` são capturas de verdade
desta conta, com a estrutura preservada e só os dados pessoais trocados.

```jsonc
{
  "secret": "…",                    // o segredo do painel, no corpo
  "event": "purchase_approved",
  "data": [                          // ← LISTA, não objeto
    {
      "id": "…uuid…",                // id do pedido: chave de idempotência
      "refId": "4HSuUHa",
      "status": "paid",              // ⚠ status do PEDIDO, não da assinatura
      "customer": { "id": 8239121, "email": "…", "name": "…" },
      "offer": { "id": "3359jgv", "name": "Teste", "price": 5 },
      "product": { "type": "subscription", … },
      "parent_order": "4HSuUHa",     // texto (refId), não objeto
      "subscription": {
        "id": "…uuid…",
        "status": "inactive",        // ⚠ também não é confiável
        "offer": "3359jgv",          // o código da oferta, em texto
        "next_payment_date": "2026-10-03T…",
        "max_retries": 3,
        "retry_interval": 1,
        "canceledAt": null
      }
    }
  ]
}
```

Três coisas que só apareceram com os payloads reais:

**1. `data` é uma lista.** A documentação descreve um objeto. Ler só o objeto
fazia todo campo sair nulo, todo webhook virar "sem conta correspondente" e
nenhuma compra liberar acesso. `corpoDoPedido()` em `contrato.ts` aceita as três
formas (lista, objeto e campos na raiz).

**2. Os campos `status` mentem — nos dois sentidos.** Em `chargeback`,
`subscription_paused` e `subscription_renewal_refused`, `data[0].status` vale
`"paid"` e `subscription.status` vale `"active"`: eles descrevem o pedido que um
dia foi pago, não o estado atual. Em `purchase_approved`, ao contrário,
`subscription.status` vale `"inactive"` numa compra aprovada.

Por isso a regra é assimétrica de propósito: **só o nome do evento libera
acesso**. O `status` cru entra apenas como rede de segurança para eventos
desconhecidos, e só quando fala de algo inequivocamente ruim (`refunded`,
`chargeback`, `canceled`, `paused`). Errar restringindo custa um ticket de
suporte; errar liberando custa o produto.

**3. A Cakto retenta pagamentos recusados.** `max_retries: 3`,
`retry_interval: 1` — daí a carência de `atrasado`.

## Sobre a tolerância a variações de formato

`contrato.ts` procura cada dado numa lista de caminhos plausíveis
(`customer.email`, `customer_email`, `customerEmail`, …) em vez de exigir um
formato exato. O caso de `data` acima é exatamente o motivo: o formato que chega
não é necessariamente o formato documentado, e descobrir isso em produção não
pode custar as compras que chegarem nesse meio-tempo.

A tolerância para no que importa: **a conferência do segredo e a decisão de
acesso não adivinham nada**. Segredo é comparado em tempo constante contra o
valor configurado, e status desconhecido cai em `sem_assinatura`, que não
libera.

Se a sua conta mandar um evento que não está no mapa, a tela de eventos mostra
exatamente o que veio, e acrescentar uma linha em `EVENTO_PARA_STATUS` resolve —
que é o motivo de o corpo cru ser guardado.
