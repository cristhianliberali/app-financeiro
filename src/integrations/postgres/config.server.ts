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
 * Configuração do chat de IA (`/transacoes`, `/` — o botão "Assistente").
 *
 * É separada da importação de propósito. São dois trabalhos diferentes: a
 * importação lê um documento inteiro e paga por isso; o chat interpreta uma
 * frase curta e precisa responder na hora. Separar deixa cada um no provedor e
 * no modelo que lhe serve — hoje o chat usa a Groq, que tem cota gratuita e é
 * rápida o bastante para uma conversa.
 *
 * A API da Groq fala o mesmo dialeto da OpenAI (`/chat/completions`), então
 * `GROQ_BASE_URL` também serve para apontar o chat a qualquer outro serviço
 * compatível sem tocar em código.
 */
export type ChatSettings = {
  provider: "groq";
  model: string;
  apiKey: string;
  baseUrl: string;
  /** Quantas mensagens anteriores acompanham a pergunta atual. */
  historyLimit: number;
  /** Teto de tokens da resposta. O contrato é curto; isto é só uma trava. */
  maxTokens: number;
};

const CHAT_PROVIDERS = ["groq"] as const;

/** Modelo gratuito da Groq que dá conta do contrato; trocável por MODELO_IA_CHAT. */
const DEFAULT_CHAT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function getChatSettings(): ChatSettings {
  const provider = (readEnv("PROVEDOR_IA_CHAT") ?? "groq").toLowerCase();
  if (!(CHAT_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `PROVEDOR_IA_CHAT "${provider}" não é suportado. ` +
        `Provedores disponíveis: ${CHAT_PROVIDERS.join(", ")}.`,
    );
  }

  const apiKey = readEnv("GROQ_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Chat de IA não configurado. Defina GROQ_API_KEY no serviço — veja .env.example. " +
        "A chave é criada em console.groq.com/keys e tem cota gratuita.",
    );
  }

  const baseUrl = (readEnv("GROQ_BASE_URL") ?? DEFAULT_GROQ_BASE_URL).replace(/\/+$/, "");

  return {
    provider: provider as "groq",
    model: readEnv("MODELO_IA_CHAT") ?? DEFAULT_CHAT_MODEL,
    apiKey,
    baseUrl,
    historyLimit: readInt("CHAT_IA_HISTORICO", 6),
    maxTokens: readInt("CHAT_IA_MAX_TOKENS", 800),
  };
}

/** A tela usa isto para esconder o chat quando não há chave configurada. */
export function isChatConfigured(): boolean {
  try {
    getChatSettings();
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

/**
 * Integração com o Google Agenda.
 *
 * As credenciais vêm de um projeto no Google Cloud Console (OAuth 2.0, tipo
 * "Aplicativo da Web"), e a conexão é por usuário: cada um autoriza o app na
 * própria conta. Sem `GOOGLE_CLIENT_ID` o app segue igual — só a agenda fica
 * indisponível, com a tela dizendo o que falta.
 */
export type GoogleSettings = {
  clientId: string;
  clientSecret: string;
  /**
   * Base das APIs do Google. Existe para poder apontar os testes para um
   * servidor local; em produção fica no padrão.
   */
  apiBaseUrl: string;
  authBaseUrl: string;
  tokenUrl: string;
  /** Fuso dos eventos criados na agenda. */
  timeZone: string;
  /** Minutos entre duas sincronizações automáticas do mesmo usuário. */
  syncIntervalMinutes: number;
  /** Teto de eventos lidos por sincronização, para não estourar a cota. */
  maxEventsPerSync: number;
};

export function getGoogleSettings(): GoogleSettings {
  const clientId = readEnv("GOOGLE_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_CLIENT_SECRET");

  const missing = [
    ...(clientId ? [] : ["GOOGLE_CLIENT_ID"]),
    ...(clientSecret ? [] : ["GOOGLE_CLIENT_SECRET"]),
  ];
  if (missing.length) {
    throw new Error(
      `Integração com o Google Agenda não configurada. Faltam as variáveis: ${missing.join(", ")}.`,
    );
  }

  // Uma única variável redireciona todas as chamadas — é assim que o teste
  // automatizado roda contra um Google falso, sem tocar no de verdade.
  const base = readEnv("GOOGLE_API_BASE_URL");

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    apiBaseUrl: base ?? "https://www.googleapis.com",
    authBaseUrl: base ? `${base}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: base ? `${base}/token` : "https://oauth2.googleapis.com/token",
    timeZone: readEnv("GOOGLE_CALENDAR_TIMEZONE") ?? "America/Sao_Paulo",
    syncIntervalMinutes: readInt("GOOGLE_SYNC_INTERVALO_MINUTOS", 10),
    maxEventsPerSync: readInt("GOOGLE_MAX_EVENTOS_SYNC", 500),
  };
}

/** A tela usa isto para explicar por que a agenda não pode ser conectada. */
export function isGoogleConfigured(): boolean {
  try {
    getGoogleSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Segredo que cifra os tokens do Google guardados no banco. Sem uma variável
 * própria, deriva do segredo do cliente OAuth — que já é secreto e já precisa
 * existir para a integração funcionar.
 */
export function getGoogleTokenSecret(): string {
  return readEnv("GOOGLE_TOKEN_SECRET") ?? getGoogleSettings().clientSecret;
}

export type CalendarLogSettings = {
  /** Uma linha por evento que diz respeito a uma tarefa, com a decisão tomada. */
  enabled: boolean;
  /** Também os eventos que não são espelho de tarefa nenhuma. Barulhento. */
  todosOsEventos: boolean;
};

/**
 * O log da sincronização da agenda.
 *
 * Ligado por padrão, e de propósito: "a agenda não está sincronizando" tem meia
 * dúzia de causas que, sem o registro do que a leitura viu e do que ela decidiu,
 * são indistinguíveis umas das outras. O volume é baixo porque só os eventos
 * ligados a tarefas entram — a agenda alheia da pessoa fica de fora, a menos
 * que `LOG_AGENDA_TODOS` peça o contrário.
 */
export function getCalendarLogSettings(): CalendarLogSettings {
  return {
    enabled: readBool("LOG_AGENDA", true),
    todosOsEventos: readBool("LOG_AGENDA_TODOS", false),
  };
}

/**
 * Segredo que libera a rodada de sincronização por HTTP.
 *
 * Sem valor, a rota não existe: um endereço que dispara trabalho para todos os
 * usuários conectados não pode ficar aberto, e não há aqui nenhum padrão
 * razoável para inventar.
 */
export function getGoogleSyncToken(): string | undefined {
  return readEnv("GOOGLE_SYNC_TOKEN");
}

/** Nome do cookie que carrega o token de sessão. */
export function getSessionCookieName(): string {
  return readEnv("SESSION_COOKIE_NAME") ?? "aura_session";
}

/** Validade da sessão, em dias. */
export function getSessionTtlDays(): number {
  return readInt("SESSION_TTL_DAYS", 30);
}
