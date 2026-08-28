/**
 * Leitura e validação das variáveis de ambiente do Postgres.
 *
 * Tudo aqui é lido em *runtime* pelo servidor Node — nenhuma dessas variáveis
 * tem o prefixo VITE_, então nada disso entra no bundle do navegador. Trocar
 * host, senha ou schema é editar a env do serviço e reiniciar o container, sem
 * rebuild da imagem.
 */

/** Nome de schema/identificador simples, seguro para interpolar em SQL. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBool(name: string, fallback: boolean): boolean {
  const value = readEnv(name)?.toLowerCase();
  if (value === undefined) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(value)) return true;
  if (["false", "0", "no", "n", "off"].includes(value)) return false;
  throw new Error(`Variável ${name} precisa ser true ou false (recebido: "${value}").`);
}

function readInt(name: string, fallback: number): number {
  const value = readEnv(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Variável ${name} precisa ser um número inteiro positivo (recebido: "${value}").`,
    );
  }
  return parsed;
}

export type PostgresSettings = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schema: string;
  /** Tamanho máximo do pool de conexões do processo Node. */
  poolSize: number;
};

/**
 * Schema onde ficam as tabelas da aplicação. Vai para o `search_path` da
 * conexão, então as queries continuam escritas sem prefixo de schema.
 */
export function getPostgresSchema(): string {
  const schema = readEnv("POSTGRES_SCHEMA") ?? "public";
  if (!IDENTIFIER.test(schema)) {
    throw new Error(
      `POSTGRES_SCHEMA inválido: "${schema}". Use apenas letras, números e underscore.`,
    );
  }
  return schema;
}

export function getPostgresSettings(): PostgresSettings {
  const host = readEnv("POSTGRES_HOST");
  const database = readEnv("POSTGRES_DB");
  const user = readEnv("POSTGRES_USER");
  const password = readEnv("POSTGRES_PASSWORD");

  const missing = [
    ...(host ? [] : ["POSTGRES_HOST"]),
    ...(database ? [] : ["POSTGRES_DB"]),
    ...(user ? [] : ["POSTGRES_USER"]),
    ...(password ? [] : ["POSTGRES_PASSWORD"]),
  ];
  if (missing.length) {
    throw new Error(
      `Variáveis de ambiente do Postgres ausentes: ${missing.join(", ")}. ` +
        `Configure-as no serviço (EasyPanel) ou no .env local — veja .env.example.`,
    );
  }

  return {
    host: host!,
    database: database!,
    user: user!,
    password: password!,
    port: readInt("POSTGRES_PORT", 5432),
    ssl: readBool("POSTGRES_SSL", false),
    schema: getPostgresSchema(),
    poolSize: readInt("POSTGRES_POOL_MAX", 10),
  };
}

/**
 * `CREATE_USERS_HOME` liga/desliga o cadastro de novos usuários na tela de
 * entrada do app. Com `false`, o formulário some do front e o servidor recusa
 * qualquer tentativa de cadastro — as contas passam a existir só por convite
 * ou por criação direta no banco.
 */
export function isSignupOpen(): boolean {
  return readBool("CREATE_USERS_HOME", true);
}

/**
 * Configuração do provedor de IA usado na importação de faturas.
 *
 * `PROVEDOR_IA` existe para o dia em que houver mais de um provedor; hoje só
 * `openai` é aceito, e qualquer outro valor falha na hora em vez de tentar uma
 * requisição que não vai funcionar.
 */
export type AiSettings = {
  provider: "openai";
  model: string;
  /** Teto de tokens do documento por requisição; acima disso, vira lote. */
  tokenLimit: number;
  apiKey: string;
};

const SUPPORTED_PROVIDERS = ["openai"] as const;

export function getAiProvider(): "openai" {
  const provider = (readEnv("PROVEDOR_IA") ?? "openai").toLowerCase();
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `PROVEDOR_IA "${provider}" não é suportado. Provedores disponíveis: ${SUPPORTED_PROVIDERS.join(", ")}.`,
    );
  }
  return provider as "openai";
}

export function getAiSettings(): AiSettings {
  const provider = getAiProvider();
  const model = readEnv("MODELO_IA");
  const apiKey = readEnv("OPENAI_API_KEY");

  const missing = [...(model ? [] : ["MODELO_IA"]), ...(apiKey ? [] : ["OPENAI_API_KEY"])];
  if (missing.length) {
    throw new Error(
      `Importação por IA não configurada. Faltam as variáveis: ${missing.join(", ")}.`,
    );
  }

  return {
    provider,
    model: model!,
    apiKey: apiKey!,
    // O teto é do texto do documento, não da resposta: o que passar disso é
    // dividido em lotes processados um por vez.
    tokenLimit: readInt("LIMITE_TOKENS", 12_000),
  };
}

/** A tela de importação usa isto para se esconder quando não há IA configurada. */
export function isAiConfigured(): boolean {
  try {
    getAiSettings();
    return true;
  } catch {
    return false;
  }
}

/** Nome do cookie que carrega o token de sessão. */
export function getSessionCookieName(): string {
  return readEnv("SESSION_COOKIE_NAME") ?? "aura_session";
}

/** Validade da sessão, em dias. */
export function getSessionTtlDays(): number {
  return readInt("SESSION_TTL_DAYS", 30);
}
