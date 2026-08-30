import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

export type Attachment = {
  id: string;
  task_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  url: string;
  download_url: string;
};

function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

/** A tela usa isto para explicar por que os anexos estão indisponíveis. */
export const getStorageConfig = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ enabled: boolean; maxUploadMb: number }> => {
    const { getS3Settings, isS3Configured } = await import("@/integrations/postgres/config.server");
    if (!isS3Configured()) return { enabled: false, maxUploadMb: 0 };
    return {
      enabled: true,
      maxUploadMb: Math.round(getS3Settings().maxUploadBytes / 1024 / 1024),
    };
  });

export const fetchAttachments = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { taskId: string }) => ({ taskId: requireId(input?.taskId, "taskId") }))
  .handler(async ({ data, context }): Promise<Attachment[]> => {
    const { listAttachments } = await import("@/integrations/postgres/attachments.server");
    return listAttachments(context.user.id, data.taskId);
  });

/** Etapa 1 do envio: devolve a URL assinada para o navegador mandar o arquivo. */
export const startUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { taskId: string; fileName: string; contentType: string; size: number }) => ({
      taskId: requireId(input?.taskId, "taskId"),
      fileName: requireId(input?.fileName, "fileName"),
      contentType: typeof input?.contentType === "string" ? input.contentType : "",
      size: Number(input?.size) || 0,
    }),
  )
  .handler(
    async ({ data, context }): Promise<{ key: string; url: string; expiresInSeconds: number }> => {
      const { startUpload: run } = await import("@/integrations/postgres/attachments.server");
      return run(context.user.id, data);
    },
  );

/** Etapa 2: o arquivo já está no bucket; vira anexo da tarefa. */
export const confirmUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { taskId: string; key: string; fileName: string; contentType: string }) => ({
      taskId: requireId(input?.taskId, "taskId"),
      key: requireId(input?.key, "key"),
      fileName: requireId(input?.fileName, "fileName"),
      contentType: typeof input?.contentType === "string" ? input.contentType : "",
    }),
  )
  .handler(async ({ data, context }): Promise<Attachment> => {
    const { confirmUpload: run } = await import("@/integrations/postgres/attachments.server");
    return run(context.user.id, data);
  });

export const removeAttachment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id, "id") }))
  .handler(async ({ data, context }): Promise<null> => {
    const { deleteAttachment } = await import("@/integrations/postgres/attachments.server");
    await deleteAttachment(context.user.id, data.id);
    return null;
  });
