/**
 * Armazenamento dos anexos em S3 (ou compatível: MinIO, R2, B2, Wasabi…).
 *
 * O arquivo nunca passa pelo servidor Node: o navegador envia direto para o
 * bucket com uma URL assinada de escrita, e lê com uma URL assinada de leitura.
 * Um vídeo de 200 MB não ocupa memória do container, e as credenciais do bucket
 * não saem daqui — o que vai para o navegador é sempre uma URL com prazo.
 *
 * Isso exige CORS liberado no bucket para o domínio do app (só o envio precisa;
 * imagem, vídeo e PDF carregam sem CORS). Veja docs/DEPLOY-EASYPANEL.md.
 */
import { randomUUID } from "node:crypto";

import { getS3Settings, type S3Settings } from "../postgres/config.server";

type S3Client = import("@aws-sdk/client-s3").S3Client;

let client: S3Client | undefined;
let clientKey = "";

function keyOf(settings: S3Settings): string {
  return [
    settings.bucket,
    settings.region,
    settings.endpoint ?? "",
    settings.accessKeyId,
    settings.forcePathStyle,
  ].join("|");
}

/** Cliente reaproveitado entre requisições; refeito quando a env muda. */
async function getClient(): Promise<{ client: S3Client; settings: S3Settings }> {
  const settings = getS3Settings();
  const key = keyOf(settings);

  if (!client || clientKey !== key) {
    const { S3Client: Client } = await import("@aws-sdk/client-s3");
    client = new Client({
      region: settings.region,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      forcePathStyle: settings.forcePathStyle,
    });
    clientKey = key;
  }

  return { client, settings };
}

/** Nome de arquivo seguro para compor a chave do objeto. */
function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "arquivo"
  );
}

/**
 * Chave do objeto. O UUID no meio evita dois arquivos de mesmo nome se
 * atropelarem, e o prefixo por tarefa mantém o bucket navegável.
 */
export function buildKey(taskId: string, fileName: string): string {
  return `tarefas/${taskId}/${randomUUID()}-${slug(fileName)}`;
}

/** URL de escrita: o navegador faz PUT nela, com o mesmo Content-Type. */
export async function signUpload(input: {
  key: string;
  contentType: string;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const { client: s3, settings } = await getClient();
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: input.key,
      ContentType: input.contentType,
    }),
    { expiresIn: settings.signedUrlTtlSeconds },
  );

  return { url, expiresInSeconds: settings.signedUrlTtlSeconds };
}

/**
 * URL de leitura. `download` troca a disposição para anexo, que é o que faz o
 * navegador salvar o arquivo em vez de abri-lo.
 */
export async function signDownload(input: {
  key: string;
  fileName: string;
  contentType: string;
  download?: boolean;
}): Promise<string> {
  const { client: s3, settings } = await getClient();
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  // O nome entre aspas, sem caracteres de controle, para o cabeçalho não quebrar.
  const safeName = input.fileName.replace(/["\\\r\n]/g, "_");

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: settings.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: `${input.download ? "attachment" : "inline"}; filename="${safeName}"`,
    }),
    { expiresIn: settings.signedUrlTtlSeconds },
  );
}

/** Apaga o objeto. Falhar aqui não pode impedir a remoção do registro no banco. */
export async function deleteObject(key: string): Promise<void> {
  const { client: s3, settings } = await getClient();
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await s3.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
}

/** Confere se o objeto chegou mesmo ao bucket, e com que tamanho. */
export async function headObject(key: string): Promise<{ size: number; contentType: string }> {
  const { client: s3, settings } = await getClient();
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const result = await s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
  return {
    size: Number(result.ContentLength ?? 0),
    contentType: result.ContentType ?? "application/octet-stream",
  };
}
