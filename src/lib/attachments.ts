import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  confirmUpload,
  fetchAttachments,
  getStorageConfig,
  removeAttachment,
  startUpload,
  type Attachment,
} from "./attachments.functions";

export type { Attachment };

/** Está configurado o bucket? E qual o teto por arquivo? */
export function useStorageConfig() {
  return useQuery({
    queryKey: ["storage-config"],
    queryFn: () => getStorageConfig(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAttachments(taskId: string | null) {
  return useQuery({
    queryKey: ["attachments", taskId],
    enabled: !!taskId,
    queryFn: () => fetchAttachments({ data: { taskId: taskId! } }),
    // As URLs são assinadas com prazo; recarregar de tempos em tempos evita
    // que a tela fique com um link vencido na mão.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Envio em duas etapas: o servidor assina, o navegador manda o arquivo direto
 * para o bucket e volta para confirmar. O arquivo não passa pelo servidor.
 */
export function useUploadAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<Attachment> => {
      const started = await startUpload({
        data: {
          taskId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        },
      });

      const response = await fetch(started.url, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      }).catch(() => null);

      if (!response || !response.ok) {
        throw new Error(
          "O navegador não conseguiu enviar o arquivo ao armazenamento. " +
            "Confira as regras de CORS do bucket para o domínio do app.",
        );
      }

      return confirmUpload({
        data: {
          taskId,
          key: started.key,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", taskId] }),
  });
}

export function useDeleteAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await removeAttachment({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", taskId] }),
  });
}
