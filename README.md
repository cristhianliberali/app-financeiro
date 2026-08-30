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

Toda requisição de IA fica registrada no log do servidor — o prompt enviado e a
resposta crua —, para conferir depois o que o modelo recebeu e o que devolveu.
Ligado por padrão, ajustável em `LOG_IA*` (veja `.env.example`).

Numa fatura com muitos lançamentos o modelo pula linhas sem avisar, então o
servidor confere: toda linha do documento com data e valor precisa ter um
lançamento correspondente. As que faltarem voltam para o modelo numa segunda
passada, só elas; o que ainda assim não voltar é mostrado na tela como aviso, em
vez de sumir. O documento também é dividido em lotes por número de lançamentos
(`LIMITE_LANCAMENTOS_LOTE`), que é o que mantém a resposta curta o bastante para
o modelo transcrever tudo.

Lista de transações recentes e filtro por categoria, paginada com seletor de
10 / 50 / 100 registros por página.

#Centro de categorias
Categorias de entrada e saída
Com teto de gastos de cada categoria de sáida (para definir um orçamento)

Categoria não é apagada: é **arquivada**, confirmando com o nome digitado. Ela
continua aparecendo nos relatórios e nos lançamentos antigos, e só some das
listas de lançamento novo, recorrência e importação por IA. Dá para reativar a
qualquer momento.

#Centro de investimento e planejamento
Investimentos realizados (com rendimentos estimados x reais)
Metas de investimento
Metas de economia

#Objetivos e metas
Metas pessoais
Metas financeiras

#Projetos e Tarefas
Segundo módulo do app, com tela própria. A troca entre os dois é o seletor
**Finanças / Projetos e Tarefas** no topo do menu lateral.

Hierarquia: conta → espaços → quadros → tarefas → subtarefas. O menu lateral traz
a árvore de espaços e quadros (recolhível), e o cabeçalho mostra o caminho
`Espaço / Quadro`, com uma seta em cada nível para pular direto para outro espaço
ou quadro.

- Kanban, lista e calendário por quadro, com busca e filtros por prioridade,
  etiqueta e responsável; a lista é paginada, com seletor de 10 / 50 / 100
  registros por página;
- **Responsável**: se ninguém for escolhido, quem criou a tarefa fica responsável;
- **Prioridade** (urgente, alta, normal, baixa) com nome e cor no cartão e na
  lista — junto de entrada/saída de dinheiro, é o que escapa do preto e branco;
- **Etiquetas** da conta, reaproveitadas entre quadros, com filtro próprio;
- **Estimativa de horas** por tarefa, comparada com o tempo cronometrado no
  dashboard (estimado x realizado, saldo de horas, o que estourou);
- **Lembretes** por tarefa, entregues como notificação do navegador e no sininho
  do cabeçalho;
- Exclusão protegida: espaço e quadro pedem o nome digitado, tarefa pede
  confirmação, e uma etapa com tarefas não pode ser excluída — mova ou exclua as
  tarefas dela antes.

#Conta e perfil
No canto inferior esquerdo do menu lateral (nos dois módulos) fica o ícone do
perfil: nome, troca de e-mail e senha.

- **Trocar o e-mail** manda um código de 6 dígitos para o endereço novo — só
  conclui quem realmente recebe lá;
- **Senha** pode ser trocada com a senha atual, ou redefinida por link enviado
  por e-mail ("Esqueci minha senha", também na tela de entrada);
- Os dois fluxos dependem de um **SMTP** configurado por variáveis de ambiente
  (`SMTP_*`). Sem ele, o resto do app funciona normalmente e a tela avisa o que
  falta.

#Tema
Preto e branco, claro e escuro, no sistema inteiro. A escolha fica no rodapé do
menu lateral (claro / escuro / seguir o sistema) e é lembrada no navegador.

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
`bun run db:migrate` (ou cole [`db/schema.sql`](db/schema.sql) no console SQL do
seu painel) e confira a conexão com `bun run db:check` — detalhes em
[`db/README.md`](db/README.md).

## Deploy

O repositório inclui um `Dockerfile` que gera um servidor Node standalone
(SSR + estáticos no mesmo processo), pronto para rodar no EasyPanel ou em
qualquer host com Docker.

Passo a passo, variáveis de ambiente e configuração de domínio:
**[docs/DEPLOY-EASYPANEL.md](docs/DEPLOY-EASYPANEL.md)**.

As variáveis usadas pelo app estão documentadas em
[`.env.example`](.env.example) — atenção à diferença entre as `VITE_*` (build)
e as demais (runtime).
