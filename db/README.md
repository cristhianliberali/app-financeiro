# Banco de dados

O app usa um Postgres próprio, acessado direto pelo servidor Node (driver `pg`).
Não há Supabase, PostgREST nem RLS no caminho: o navegador nunca fala com o
banco — ele chama *server functions*, e elas é que consultam o Postgres.

## Aplicar o schema

`schema.sql` cria tudo: tabelas, índices, triggers e funções. É SQL puro, sem
comandos de cliente, então roda igual em qualquer lugar. É idempotente — pode
rodar de novo em um banco já populado sem perder dados.

**Pelo terminal, com as variáveis do app** (não precisa de psql nem de cliente
externo — usa a mesma conexão que o servidor usa):

```sh
bun run db:migrate
```

**Pelo console SQL do painel**: cole o conteúdo de `db/schema.sql` inteiro e
execute. O arquivo é uma colagem só, de propósito.

**Pelo psql**, se preferir:

```sh
psql "postgresql://USUARIO:SENHA@HOST:PORTA/BANCO" -v ON_ERROR_STOP=1 -f db/schema.sql
```

Para conferir a conexão e se o schema está completo:

```sh
bun run db:check
```

## Schema diferente de `public`

Se `POSTGRES_SCHEMA` não for `public`, troque `public` pelo nome do seu schema
nas duas linhas do topo do `schema.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS meu_schema;
SET search_path TO meu_schema;
```

Os dois valores — o do arquivo e o de `POSTGRES_SCHEMA` — precisam ser iguais.
O app coloca esse schema no `search_path` da conexão, então as queries seguem
sem prefixo.

## Tabelas

| Tabela | Para quê |
| --- | --- |
| `app_users` | Usuários e hash da senha (scrypt) |
| `user_sessions` | Um registro por login ativo; guarda só o SHA-256 do token do cookie |
| `accounts` | Espaço de trabalho compartilhável |
| `account_members` | Quem participa de cada conta e com qual papel (`owner`/`editor`/`viewer`) |
| `account_invites` | Convites pendentes, por e-mail, com token e prazo |
| `budget_profiles` | Perfis (Pessoal, Empresa…) que isolam os dados dentro de uma conta |
| `categories` | Categorias de entrada e saída, com teto mensal |
| `transactions` | Lançamentos, inclusive parcelas |
| `recurring_rules` | Receitas e despesas recorrentes |
| `investments` | Investimentos e rendimento esperado |
| `goals` | Metas pessoais e financeiras |

## Autorização

As policies de RLS do Supabase foram substituídas por checagens no servidor, em
`src/integrations/postgres/access.server.ts`. Toda leitura ou escrita começa por
`requireAccountRole` / `requireProfileAccess`, que confirmam o papel do usuário
na conta dona do registro.

Consequência prática: o usuário do banco configurado em `POSTGRES_USER` tem
acesso total às tabelas. Trate essa credencial como segredo de produção e não a
compartilhe com outros serviços.

## Manutenção

Sessões expiradas não atrapalham o login, mas acumulam. Para limpar:

```sql
SELECT purge_expired_sessions();
```

## Primeiro usuário

Senhas são geradas com scrypt pelo Node, então não dá para criar um usuário só
com SQL. Suba o app com `CREATE_USERS_HOME=true` e cadastre-se pela tela
inicial. Com o banco ainda vazio, o primeiro cadastro é liberado mesmo com
`CREATE_USERS_HOME=false` — senão ninguém conseguiria entrar.
