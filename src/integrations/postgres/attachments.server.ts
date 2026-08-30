/**
 * Anexos de tarefa: o registro no banco e a ponte com o bucket.
 *
 * O envio é em duas etapas — o servidor assina a URL, o navegador manda o
 * arquivo direto para o bucket e volta para confirmar. A linha só é gravada na
 * confirmação, e só depois de o servidor conferir no bucket que o objeto chegou
 * mesmo: sem isso bastaria chamar a confirmação para inventar um anexo.
 */
import { query, queryOne } from "./client.server";
import { getS3Settings } from "./config.server";
import { requireTaskAccess } from "./tasks.server";
import { buildKey, deleteObject, headObject, signDownload, signUpload } from "../storage/s3.server";

export type Attachment = {
  id: string;
  task_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  /** URL assinada para exibir na tela (imagem, vídeo, PDF). */
  url: string;
  /** URL assinada que o navegador salva como arquivo. */
  download_url: string;
};

type Row = Omit<Attachment, "url" | "download_url"> & { object_key: string };

const COLUMNS =
  "id, task_id, object_key, file_name, content_type, size_bytes, uploaded_by, " +
  `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`;

/** Nome de arquivo aceitável: sem caminho, sem caractere de controle. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // Sem caracteres de controle, que não pertencem a nome de arquivo nem a
  // cabeçalho HTTP. Filtrar por código evita uma regex ilegível.
  const clean = [...base]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  if (!clean) throw new Error("Nome de arquivo inválido");
  return clean.slice(0, 200);
}

async function withUrls(rows: Row[]): Promise<Attachment[]> {
  return Promise.all(
    rows.map(async ({ object_key, ...row }) => ({
      ...row,
      url: await signDownload({
        key: object_key,
        fileName: row.file_name,
        contentType: row.content_type,
      }),
      download_url: await signDownload({
        key: object_key,
        fileName: row.file_name,
        contentType: row.content_type,
        download: true,
      }),
    })),
  );
}

export async function listAttachments(userId: string, taskId: string): Promise<Attachment[]> {
  await requireTaskAccess(userId, taskId, "viewer");
  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM task_attachments WHERE task_id = $1 ORDER BY created_at DESC`,
    [taskId],
  );
  return withUrls(rows);
}

/** Etapa 1: confere permissão e tamanho, e devolve a URL de envio. */
export async function startUpload(
  userId: string,
  input: { taskId: string; fileName: string; contentType: string; size: number },
): Promise<{ key: string; url: string; expiresInSeconds: number }> {
  await requireTaskAccess(userId, input.taskId, "editor");
  const settings = getS3Settings();

  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new Error("Arquivo vazio.");
  }
  if (input.size > settings.maxUploadBytes) {
    throw new Error(
      `Arquivo de ${(input.size / 1024 / 1024).toFixed(1)} MB excede o limite de ` +
        `${Math.round(settings.maxUploadBytes / 1024 / 1024)} MB por arquivo.`,
    );
  }

  const fileName = cleanFileName(input.fileName);
  const key = buildKey(input.taskId, fileName);
  const { url, expiresInSeconds } = await signUpload({
    key,
    contentType: input.contentType || "application/octet-stream",
  });

  return { key, url, expiresInSeconds };
}

/** Etapa 2: o objeto está no bucket? Então vira anexo da tarefa. */
export async function confirmUpload(
  userId: string,
  input: { taskId: string; key: string; fileName: string; contentType: string },
): Promise<Attachment> {
  await requireTaskAccess(userId, input.taskId, "editor");

  // A chave é montada pelo servidor com o id da tarefa; conferir o prefixo
  // impede que uma confirmação forjada anexe um objeto de outra tarefa.
  if (!input.key.startsWith(`tarefas/${input.taskId}/`)) {
    throw new Error("Chave de objeto inválida para esta tarefa.");
  }

  const object = await headObject(input.key).catch(() => null);
  if (!object) throw new Error("O arquivo não chegou ao armazenamento. Tente enviar de novo.");

  const settings = getS3Settings();
  if (object.size > settings.maxUploadBytes) {
    await deleteObject(input.key).catch(() => {});
    throw new Error("Arquivo acima do limite permitido.");
  }

  const row = await queryOne<Row>(
    `INSERT INTO task_attachments (task_id, object_key, file_name, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [
      input.taskId,
      input.key,
      cleanFileName(input.fileName),
      input.contentType || object.contentType,
      object.size,
      userId,
    ],
  );
  if (!row) throw new Error("Não foi possível registrar o anexo.");

  const [attachment] = await withUrls([row]);
  return attachment!;
}

export async function deleteAttachment(userId: string, attachmentId: string): Promise<void> {
  const found = await queryOne<{ task_id: string; object_key: string }>(
    `SELECT task_id, object_key FROM task_attachments WHERE id = $1`,
    [attachmentId],
  );
  if (!found) return;
  await requireTaskAccess(userId, found.task_id, "editor");

  await query(`DELETE FROM task_attachments WHERE id = $1`, [attachmentId]);
  // O registro é a fonte da verdade da tela; um objeto órfão no bucket não pode
  // impedir a remoção, então a falha aqui é só registrada.
  await deleteObject(found.object_key).catch((error) =>
    console.error("[s3] não foi possível apagar o objeto:", error),
  );
}
