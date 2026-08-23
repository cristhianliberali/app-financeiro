# My Money Flow

Quero criar um app para gerir meus gastos mensais e economias pessoais com gráficos intuitivos.

#Dashboard Inicial - Gráficos e relatórios
A página home mostra os gráficos com relatório de receitas e despesas, permitindo filtrar por categorias e períodos específicos de tempo. (Escolhendo 2 tipos de data, data da transação e a data de vencimento)

Logo posso analisar com base em quanto as transações ocorreram e como pago por isso ao longo do tempo em compras parceladas, permitindo identificar melhor o impacto no orçamento futuro.

Relatório de gastos, saldo e teto da categoria (com visualização dinãmica dos dados, mudando a data, ele divide o orçamento mensal e avalia o orçamento para dia/semana proporcional aos dias selecionados.)

Quero gráfico de saldo geral, total de receitas, total de despesas, despesas por categoria, entradas por categoria, grafico de periodo mensal que mostra despesa e receita por mês e também evolução do saldo total.
Quero a possibilidade de ter multiplos perfis (ex: pessoal e empresa) selecionaveis la no topo.

#Centro de transações
Botão para incluir nova receita, nova despesa, configurar receita ou despesa recorrente , e filtros de data para facilitar a consulta. e busca avançada por descrição ou valor.

Um botão re lançar fatura ou extrato da conta e uma IA analisar tudo e retornar como uma lista categorizando tudo para conferrencia manual e lançamento após ajustes (em massa)

Lista de transações recentes e filtro por categoria

#Centro de categorias
Categorias de entrada e saída
Com teto de gastos de cada categoria de sáida (para definir um orçamento)

#Centro de investimento e planejamento
Investimentos realizados (com rendimentos estimados x reais)
Metas de investimento
Metas de economia

#Objetivos e metas
Metas pessoais
Metas financeiras

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dca9c982-56c6-4cf8-88b1-d604cca1ac54).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
cp .env.example .env   # ajuste a conexão do Postgres e o domínio
npm run dev
```

O app precisa de um Postgres com o schema aplicado. Crie as tabelas com
[`db/schema.sql`](db/schema.sql) e confira a conexão com `bun run db:check` —
detalhes em [`db/README.md`](db/README.md).

## Deploy

O repositório inclui um `Dockerfile` que gera um servidor Node standalone
(SSR + estáticos no mesmo processo), pronto para rodar no EasyPanel ou em
qualquer host com Docker.

Passo a passo, variáveis de ambiente e configuração de domínio:
**[docs/DEPLOY-EASYPANEL.md](docs/DEPLOY-EASYPANEL.md)**.

As variáveis usadas pelo app estão documentadas em
[`.env.example`](.env.example) — atenção à diferença entre as `VITE_*` (build)
e as demais (runtime).
