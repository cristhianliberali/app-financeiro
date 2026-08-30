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
  /**
   * Teto de lançamentos por requisição. É o limite que importa numa fatura
   * grande: pedir uma centena de lançamentos de uma vez faz o modelo pular
   * linhas — e ele não avisa quando pula.
   */
  entryLimit: number;
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
    entryLimit: readInt("LIMITE_LANCAMENTOS_LOTE", 40),
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

/**
 * Logs das requisições de IA.
 *
 * Ficam ligados por padrão: sem eles não há como conferir o que foi enviado ao
 * modelo nem o que ele devolveu quando uma importação sai errada. O conteúdo é
 * truncado em `LOG_IA_LIMITE_CARACTERES` para uma fatura grande não encher o
 * log do container.
 */
export type AiLogSettings = {
  enabled: boolean;
  /** Inclui o texto enviado e a resposta crua, não só os números. */
  includeBody: boolean;
  /** Teto de caracteres de cada trecho registrado. */
  maxChars: number;
};

export function getAiLogSettings(): AiLogSettings {
  return {
    enabled: readBool("LOG_IA", true),
    includeBody: readBool("LOG_IA_CORPO", true),
    maxChars: readInt("LOG_IA_LIMITE_CARACTERES", 2_000),
  };
}

/**
 * Servidor SMTP usado na redefinição de senha e na troca de e-mail.
 *
 * Tudo é lido em runtime: trocar de provedor de e-mail é editar as variáveis do
 * serviço e reiniciar. Sem `SMTP_HOST` o app continua funcionando — só os
 * recursos que dependem de e-mail é que ficam indisponíveis, com mensagem
 * explicando o que falta.
 */
export type SmtpSettings = {
  host: string;
  port: number;
  /** TLS direto na conexão (porta 465). Em 587 o TLS sobe via STARTTLS. */
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  /** Endereço no campo De:. */
  from: string;
  /** Nome exibido junto do endereço. */
  fromName: string;
  /** `false` aceita certificado autoassinado — útil em SMTP interno. */
  rejectUnauthorized: boolean;
};

export function getSmtpSettings(): SmtpSettings {
  const host = readEnv("SMTP_HOST");
  if (!host) {
    throw new Error(
      "Envio de e-mail não configurado. Defina SMTP_HOST (e as demais variáveis SMTP_*) " +
        "no serviço — veja .env.example.",
    );
  }

  const port = readInt("SMTP_PORT", 587);
  const user = readEnv("SMTP_USER");
  const from = readEnv("SMTP_FROM") ?? user;
  if (!from) {
    throw new Error("Defina SMTP_FROM (ou SMTP_USER) com o endereço remetente dos e-mails.");
  }

  return {
    host,
    port,
    secure: readBool("SMTP_SECURE", port === 465),
    user,
    password: readEnv("SMTP_PASSWORD"),
    from,
    fromName: readEnv("SMTP_FROM_NAME") ?? "Aura Finanças",
    rejectUnauthorized: readBool("SMTP_TLS_REJECT_UNAUTHORIZED", true),
  };
}

/** A tela usa isto para avisar quando a redefinição por e-mail não está de pé. */
export function isSmtpConfigured(): boolean {
  try {
    getSmtpSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Armazenamento S3 dos anexos de tarefa.
 *
 * Vale para a AWS e para qualquer serviço compatível (MinIO, Backblaze B2,
 * Cloudflare R2, Wasabi…): quem decide é `S3_ENDPOINT`. Sem `S3_BUCKET` o app
 * inteiro continua de pé — só os anexos ficam indisponíveis, com a tela
 * dizendo o que falta configurar.
 *
 * O bucket é privado: o navegador nunca recebe as chaves, e sim URLs assinadas
 * com prazo curto, geradas aqui no servidor.
 */
export type S3Settings = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Endpoint próprio (MinIO, R2, B2…). Vazio usa o da AWS. */
  endpoint: string | undefined;
  /**
   * Caminho em vez de subdomínio (`host/bucket/chave`). MinIO e a maioria dos
   * compatíveis precisam disto; a AWS trabalha com o padrão de subdomínio.
   */
  forcePathStyle: boolean;
  /** Teto de tamanho por arquivo, em bytes. */
  maxUploadBytes: number;
  /** Validade das URLs assinadas de leitura e de envio, em segundos. */
  signedUrlTtlSeconds: number;
};

export function getS3Settings(): S3Settings {
  const bucket = readEnv("S3_BUCKET");
  const accessKeyId = readEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("S3_SECRET_ACCESS_KEY");

  const missing = [
    ...(bucket ? [] : ["S3_BUCKET"]),
    ...(accessKeyId ? [] : ["S3_ACCESS_KEY_ID"]),
    ...(secretAccessKey ? [] : ["S3_SECRET_ACCESS_KEY"]),
  ];
  if (missing.length) {
    throw new Error(
      `Armazenamento de anexos não configurado. Faltam as variáveis: ${missing.join(", ")}.`,
    );
  }

  const endpoint = readEnv("S3_ENDPOINT");

  return {
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    region: readEnv("S3_REGION") ?? "us-east-1",
    endpoint,
    // Endpoint próprio quase sempre quer caminho; a AWS, não.
    forcePathStyle: readBool("S3_FORCE_PATH_STYLE", !!endpoint),
    maxUploadBytes: readInt("S3_MAX_UPLOAD_MB", 50) * 1024 * 1024,
    signedUrlTtlSeconds: readInt("S3_URL_TTL_SEGUNDOS", 900),
  };
}

/** A tela de tarefas usa isto para explicar por que os anexos estão fora. */
export function isS3Configured(): boolean {
  try {
    getS3Settings();
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
