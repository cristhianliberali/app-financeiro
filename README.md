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

O servidor confere a resposta da IA nos dois sentidos, porque ela erra dos dois
lados:

- **Faltou lançamento?** Toda linha do documento com data e valor precisa ter um
  lançamento correspondente. As que faltarem voltam para o modelo numa segunda
  passada, só elas; o que ainda assim não voltar aparece como aviso, em vez de
  sumir.
- **Sobrou lançamento?** Todo lançamento devolvido precisa casar com uma linha
  datada do documento. Fatura tem blocos com valor e sem data — "FATURA
  ANTERIOR", "DESPESAS/DÉBITOS", resumo por categoria — e o modelo às vezes lê
  isso como compra; lançar um total soma de novo tudo o que já está lançado.
  Essas linhas chegam recolhidas e desmarcadas, fora das somas, e podem ser
  vistas uma a uma em "mostrar mesmo assim".

O documento é dividido em lotes por número de lançamentos
(`LIMITE_LANCAMENTOS_LOTE`), que é o que mantém a resposta curta o bastante para
o modelo transcrever tudo; um valor bem alto manda o documento inteiro numa
requisição só. Lote que só tem cabeçalho e totais não vai para a IA, e o começo
do documento (onde está o vencimento) segue junto em todo lote, como referência.

Lista de transações recentes e filtro por categoria, paginada com seletor de
10 / 50 / 100 registros por página.

Compras parceladas, nos dois caminhos:

- **No formulário**, o botão "Lançamento parcelado" abre a quantidade de
  parcelas, divide o valor total sem perder centavo (R$ 100 em 3x vira 33,34 +
  33,33 + 33,33) e mostra antes de salvar o que será lançado — valor e
  vencimento de cada parcela, uma por mês.
- **Na importação por IA**, uma linha "01/03" na fatura significa que faltam
  duas cobranças: elas entram na relação para aprovação junto da atual, com
  vencimento avançando um mês, e são lançadas com o mesmo grupo.

As parcelas são gravadas no padrão `DESCRIÇÃO k/n`. Por causa disso, e porque o
nome muda conforme a origem, o que identifica um lançamento repetido passou a
ser a **data do lançamento, o vencimento e o valor** — sem o nome. É o que faz a
parcela projetada aqui reencontrar a linha que virá na fatura do mês seguinte, em
vez de lançar tudo de novo.

#Assistente de IA (chat)

Uma bolha flutuante no canto inferior direito, presente em todas as telas do
módulo Finanças (no computador e no celular), abre um chat onde dá para escrever
em português. Ele faz duas coisas:

- **Consultar**: "quanto gastei este mês em alimentação?" responde
  "Você gastou R$ 100,00 do seu teto de R$ 350,00". Vale para gastos, entradas e
  saldo, com ou sem categoria. Sem período informado, responde o mês atual.
- **Registrar**: "gastei 158 no mercado" monta um rascunho de lançamento —
  descrição, valor, categoria, data e situação — que aparece na tela para revisão.

Dá para mandar de três formas: escrevendo, **fotografando o comprovante** (a
imagem é lida por um modelo de visão e o texto vai para a IA, com o que foi lido
à vista numa linha discreta, para conferir) ou **falando** (o áudio é transcrito
e enviado sozinho ao parar a gravação).

A IA **nunca grava nada**. Ela devolve a intenção; quem consulta o banco, calcula
e grava é o código, e só depois do clique em Confirmar. Os números da resposta
saem de um `SUM` no Postgres e as datas ("mês passado", "ontem") são resolvidas
pelo servidor — o modelo não escreve valor nem data. Sem "já paguei" na frase, o
lançamento nasce em aberto; parcelamento usa a mesma divisão do formulário manual.

Precisa de uma chave gratuita da Groq (`GROQ_API_KEY`); sem ela o botão não
aparece e o resto do app segue igual. Os modelos de texto, imagem e áudio são
escolhidos em `MODELO_IA_CHAT`, `MODELO_IA_VISAO` e `MODELO_IA_AUDIO`. Detalhes
em `docs/chat-ia.md`.

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
- **Nome da tarefa**: as listagens (cartão, lista, calendário, agenda, lembretes)
  mostram até 70 caracteres e marcam o corte com "…" — um título longo não
  empurra o cartão para cinco linhas nem estica a coluna da tabela. Passar o
  mouse mostra o nome inteiro, e a tarefa aberta sempre traz o título completo,
  editável. A busca e a ordenação continuam olhando o nome inteiro;
- **Estimativa de horas** por tarefa, comparada com o tempo cronometrado no
  dashboard (estimado x realizado, saldo de horas, o que estourou);
- **Lembretes** por tarefa, entregues como notificação do navegador e no sininho
  do cabeçalho;
- **Anexos** por tarefa, guardados num bucket S3 (ou compatível: MinIO, R2, B2).
  Imagem, vídeo e PDF abrem na própria tela; o resto baixa. O arquivo vai do
  navegador direto para o bucket, que fica privado — o que circula são URLs
  assinadas com prazo;
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

#Receitas e despesas recorrentes
A regra não é projeção: ao salvar, ela **cria os lançamentos de verdade**, do
início dela até 24 meses à frente. O passado entra como agendado, e aparece em
Transações pendentes para receber baixa; o futuro se completa sozinho a cada
mês, na primeira vez que alguém abre uma tela de Finanças — não há rotina de
fundo para manter de pé.

A geração é idempotente (um índice único por regra e vencimento), então rodar de
novo nunca duplica nada.

Excluir a regra pergunta o que fazer com o que ela criou:

- **apagar as futuras** — some o que ainda vai vencer, a partir de amanhã;
- **apagar todas** — some o histórico inteiro daquela recorrência;
- **manter todos** — só a regra sai, e os lançamentos viram lançamentos comuns.

#Modelos de etapas
As etapas de um quadro podem virar **modelo da conta**, em "Etapas do quadro".
O modelo aparece na criação de qualquer quadro, ao lado dos conjuntos que vêm
com o app, e pode ser aplicado a um quadro já existente.

É um retrato, não um vínculo: aplicar copia as etapas e acaba ali. Mudar o
quadro depois não reescreve o modelo, e mudar o modelo não mexe em quadro
nenhum — vínculo vivo renomearia etapas em quadros que ninguém está olhando.

Aplicar **acrescenta** as etapas que faltam (comparando pelo nome) e nunca
substitui: trocar as etapas de um quadro em uso deixaria as tarefas sem etapa.

#Integração com o Google Agenda
A conexão é por pessoa: cada uma autoriza o app na própria conta, pelo perfil.
A tarefa vira compromisso na agenda de quem é **responsável** por ela — sem
responsável, sem data ou sem conta conectada, não há o que agendar e nenhum
evento é criado.

Ao conectar a conta, as tarefas com prazo que já existiam sobem para a agenda
(as dos próximos seis meses que ainda não foram concluídas); depois disso cada
rodada de sincronização recolhe o que tiver ficado para trás.

- Tarefa criada, editada ou excluída → compromisso criado, editado ou excluído;
- Compromisso **movido ou esticado** na agenda → as datas da tarefa acompanham.
  A tarefa que só tinha prazo continua só com prazo enquanto o compromisso
  mantiver a duração padrão de uma hora — arrastar no dia muda o prazo, não
  inventa um início; esticar é que a transforma num intervalo de verdade;
- Compromisso **apagado** na agenda → a tarefa perde as datas, mas **não** é
  excluída: a tarefa é o registro do trabalho, a agenda é onde ele aparece no
  dia. Tudo isso fica na trilha de atividade da tarefa;
- Os eventos vão para a **agenda principal** de cada pessoa (`primary`) — o app
  não cria nem exige uma agenda separada;
- Sincronização automática a cada 10 minutos (`GOOGLE_SYNC_INTERVALO_MINUTOS`),
  com leitura incremental para caber na cota, e um botão de sincronizar na hora
  no calendário do painel. É polling, não webhook: uma mudança feita no Google
  aparece aqui na rodada seguinte, ou na hora se a pessoa pedir a sincronização.
  O laço vive no processo web e sobe no primeiro acesso autenticado — para não
  depender disso, defina `GOOGLE_SYNC_TOKEN` e chame `POST /api/google/sync` por
  um cron, que roda a rodada e devolve em JSON o que ela fez;
- Uma tarefa que o Google recusar (uma data fora de faixa, por exemplo) fica
  registrada na trilha e sai da fila até ser corrigida — **sem** impedir que as
  outras subam. O aviso no perfil diz qual é, e o botão *Diagnosticar
  sincronização* mostra as últimas recusas, quantas tarefas esperam para subir e
  há quantos minutos foi a última leitura.

No painel de Projetos e Tarefas há três abas:

- **Visão geral** — os indicadores e gráficos de sempre;
- **Meu dia** — tarefas e compromissos de hoje separados por manhã, tarde e
  noite, com as subtarefas do dia abaixo da tarefa-mãe. O checkbox risca e move
  a tarefa para a etapa de polaridade "sucesso" do quadro dela; nas subtarefas,
  só marca como concluída. Tem atalho para criar tarefa já com a data de hoje
  (escolhendo espaço e quadro, com a etapa padrão do quadro);
- **Calendário** — semana (padrão) ou mês, com tarefas e compromissos juntos.

#Assinaturas e acesso
O app é pago, e o meio de pagamento é a **Cakto**. O estado da assinatura de
cada pessoa chega por webhook e fica em `app_users.status_plano`; o acesso é
decidido lendo essa coluna, nunca perguntando à Cakto na hora — um gateway fora
do ar não pode virar um app fora do ar.

- `status_plano`: `ativo`, `trial`, `cortesia`, `atrasado`, `cancelado`,
  `reembolsado`, `chargeback` ou `sem_assinatura`. Os três primeiros liberam;
- `codigo_oferta`: qual oferta a pessoa comprou. É por ele que se liberam
  funcionalidades por plano — o status diz *se* entra, a oferta diz *no quê*;
- quem foi convidado para a conta de um assinante entra junto
  (`CAKTO_ACESSO_HERDADO`), para não cobrar duas assinaturas pelo mesmo
  orçamento da família;
- a trava nasce **desligada** (`CAKTO_EXIGIR_ASSINATURA`): aplique o schema,
  aponte o webhook, confira no painel que os status estão chegando, e só então
  ligue. Ligar antes trancaria os usuários existentes para fora dos dados deles.

Em **/admin** há uma área de super admin, com entrada própria: usuários ativos,
busca e filtro por status, cortesia em um clique (1 mês, 3 meses, 1 ano ou sem
prazo), histórico de toda mudança com autor e motivo, e a lista crua dos eventos
recebidos da Cakto com um botão de reprocessar. O primeiro administrador sai de
`SUPER_ADMIN_EMAILS`.

Passo a passo, diagnóstico e o desenho por trás disso em
[`docs/cakto-assinaturas.md`](docs/cakto-assinaturas.md).

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
