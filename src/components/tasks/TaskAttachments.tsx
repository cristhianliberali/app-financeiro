import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Film, ImageIcon, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  useAttachments,
  useDeleteAttachment,
  useStorageConfig,
  useUploadAttachment,
  type Attachment,
} from "@/lib/attachments";

/**
 * Anexos da tarefa: arquivos guardados num bucket S3 (ou compatível).
 *
 * O arquivo vai do navegador direto para o bucket, com URL assinada pelo
 * servidor — nada trafega pelo container. O que a tela recebe de volta são
 * URLs de leitura com prazo, e é com elas que imagem, vídeo e PDF aparecem
 * aqui dentro sem precisar baixar nada.
 */
export function TaskAttachments({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const { data: config } = useStorageConfig();
  const { data: attachments = [], isPending } = useAttachments(taskId);
  const upload = useUploadAttachment(taskId);
  const remove = useDeleteAttachment(taskId);
  const fileInput = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);

  async function send(files: FileList | File[] | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync(file);
        toast.success(`"${file.name}" anexado`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Falha ao anexar "${file.name}"`);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  if (config && !config.enabled) {
    return (
      <div className="space-y-2">
        <Label>Anexos</Label>
        <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          O armazenamento de arquivos não está configurado neste ambiente. Defina as variáveis{" "}
          <code>S3_BUCKET</code>, <code>S3_ACCESS_KEY_ID</code> e <code>S3_SECRET_ACCESS_KEY</code>{" "}
          no serviço.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          Anexos{" "}
          <span className="text-xs font-normal text-muted-foreground">({attachments.length})</span>
        </Label>
        {config?.enabled && (
          <span className="text-[11px] text-muted-foreground">
            até {config.maxUploadMb} MB por arquivo
          </span>
        )}
      </div>

      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void send(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center gap-1 rounded-xl border border-dashed p-4 text-center transition-colors ${
            dragging ? "border-primary bg-secondary/60" : "border-border"
          }`}
        >
          <Upload className="size-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Arraste arquivos aqui ou{" "}
            <button
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
              className="font-medium text-foreground underline underline-offset-2"
            >
              escolha do computador
            </button>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Imagem, vídeo, PDF e qualquer outro arquivo.
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void send(e.target.files)}
          />
          {upload.isPending && <p className="text-[11px] text-muted-foreground">Enviando…</p>}
        </div>
      )}

      {isPending ? (
        <p className="text-xs text-muted-foreground">Carregando anexos…</p>
      ) : attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum anexo.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              canEdit={canEdit}
              onOpen={() => setPreview(attachment)}
              onDelete={async () => {
                await remove.mutateAsync(attachment.id);
                toast.success("Anexo removido");
              }}
            />
          ))}
        </div>
      )}

      <PreviewDialog attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function isImage(type: string) {
  return type.startsWith("image/");
}

function isVideo(type: string) {
  return type.startsWith("video/");
}

function isPdf(type: string) {
  return type === "application/pdf";
}

/** Tamanho legível: 1.2 MB em vez de 1258291. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentCard({
  attachment,
  canEdit,
  onOpen,
  onDelete,
}: {
  attachment: Attachment;
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}) {
  const previewable =
    isImage(attachment.content_type) ||
    isVideo(attachment.content_type) ||
    isPdf(attachment.content_type);
  const Icon = isVideo(attachment.content_type)
    ? Film
    : isPdf(attachment.content_type)
      ? FileText
      : isImage(attachment.content_type)
        ? ImageIcon
        : Paperclip;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-2">
      <button
        onClick={previewable ? onOpen : undefined}
        className={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary ${
          previewable ? "cursor-zoom-in" : "cursor-default"
        }`}
        aria-label={previewable ? `Ver ${attachment.file_name}` : attachment.file_name}
      >
        {isImage(attachment.content_type) ? (
          <img
            src={attachment.url}
            alt={attachment.file_name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <Icon className="size-5 text-muted-foreground" />
        )}
      </button>

      <button onClick={previewable ? onOpen : undefined} className="min-w-0 flex-1 text-left">
        <p className="truncate text-xs font-medium">{attachment.file_name}</p>
        <p className="text-[11px] text-muted-foreground">{humanSize(attachment.size_bytes)}</p>
      </button>

      <a
        href={attachment.download_url}
        download={attachment.file_name}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={`Baixar ${attachment.file_name}`}
        title="Baixar"
      >
        <Download className="size-4" />
      </a>
      {canEdit && (
        <button
          onClick={() => void onDelete()}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
          aria-label={`Remover ${attachment.file_name}`}
          title="Remover"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Visualização em tela cheia: imagem, vídeo e PDF abrem aqui mesmo. */
function PreviewDialog({
  attachment,
  onClose,
}: {
  attachment: Attachment | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!attachment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-3">
        <DialogTitle className="flex items-center gap-2 truncate pr-8 text-sm">
          <Paperclip className="size-4 shrink-0" />
          <span className="truncate">{attachment?.file_name}</span>
        </DialogTitle>

        {attachment && (
          <div className="flex max-h-[75vh] items-center justify-center overflow-auto rounded-lg bg-secondary/40">
            {isImage(attachment.content_type) ? (
              <img
                src={attachment.url}
                alt={attachment.file_name}
                className="max-h-[75vh] w-auto object-contain"
              />
            ) : isVideo(attachment.content_type) ? (
              <video src={attachment.url} controls className="max-h-[75vh] w-full" />
            ) : isPdf(attachment.content_type) ? (
              <iframe
                src={attachment.url}
                title={attachment.file_name}
                className="h-[75vh] w-full rounded-lg bg-card"
              />
            ) : (
              <p className="p-8 text-sm text-muted-foreground">
                Este tipo de arquivo não tem visualização; baixe para abrir.
              </p>
            )}
          </div>
        )}

        {attachment && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{humanSize(attachment.size_bytes)}</span>
            <a
              href={attachment.download_url}
              download={attachment.file_name}
              className="flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
            >
              <Download className="size-3.5" /> Baixar
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
