import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Opções do seletor de registros por página. */
export const PAGE_SIZES = [10, 50, 100] as const;

const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export type Pagination<T> = {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  /** Só os itens da página atual. */
  visible: T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
};

/**
 * Paginação no cliente de uma lista já carregada.
 *
 * A escolha de quantos registros mostrar fica no `localStorage` por tela
 * (`storageKey`): quem trabalha com 100 lançamentos por página não quer
 * reconfigurar isso a cada visita.
 */
export function usePagination<T>(items: T[], storageKey: string): Pagination<T> {
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  useEffect(() => {
    // Lido depois da montagem: no SSR não existe `localStorage`.
    const saved = Number(localStorage.getItem(storageKey));
    if ((PAGE_SIZES as readonly number[]).includes(saved)) setPageSizeState(saved);
  }, [storageKey]);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Filtrar a lista pode encurtá-la para menos páginas do que a atual.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const visible = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  function setPageSize(size: number) {
    setPageSizeState(size);
    setPage(1);
    localStorage.setItem(storageKey, String(size));
  }

  return { page, pageSize, totalPages, total, visible, setPage, setPageSize };
}

/**
 * Barra de paginação: seletor de registros por página e navegação.
 * Some quando a lista cabe inteira na menor página — nada a paginar.
 */
export function PaginationBar<T>({
  pagination,
  /** Nome do que está sendo listado, no plural ("lançamentos", "tarefas"). */
  itemLabel,
}: {
  pagination: Pagination<T>;
  itemLabel: string;
}) {
  const { page, pageSize, totalPages, total, setPage, setPageSize } = pagination;

  if (total <= DEFAULT_PAGE_SIZE && pageSize === DEFAULT_PAGE_SIZE) return null;

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
      <span>
        Mostrando{" "}
        <span className="font-bold text-foreground">
          {first}–{last}
        </span>{" "}
        de <span className="font-bold text-foreground">{total}</span> {itemLabel}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Por página</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 cursor-pointer rounded-lg border border-input bg-card px-2 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
            aria-label={`Registros por página (${itemLabel})`}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border bg-card p-1.5 shadow-xs transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            aria-label="Página anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-1 tabular-nums">
            Página <span className="font-bold text-foreground">{page}</span> de {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border bg-card p-1.5 shadow-xs transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            aria-label="Próxima página"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
