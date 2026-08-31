import type { Board, BoardStatus, Task } from "@/lib/tasks";
import type { KanbanColumn } from "./TaskKanban";

/**
 * Colunas do Kanban de um espaço inteiro.
 *
 * Um espaço não tem status próprios — quem tem são os quadros. Só que dois
 * quadros do mesmo espaço quase sempre repetem os mesmos nomes ("A fazer",
 * "Em andamento", "Concluído"), e mostrar cada um deles daria um quadro com a
 * mesma coluna cinco vezes. Então status de nome igual viram uma coluna só, e
 * a coluna guarda qual status ela é dentro de cada quadro: é isso que o
 * arraste consulta para mover a tarefa para o status certo do quadro dela.
 */
export type SpaceColumn = KanbanColumn & {
  /** Status equivalente em cada quadro: board_id → status_id. */
  statusByBoard: Map<string, string>;
  /** Todos os status que caem nesta coluna. */
  statusIds: Set<string>;
  /** Quadros que têm esta coluna, para o title do cabeçalho. */
  boardNames: string[];
};

/** Chave de agrupamento: nome sem acento, sem caixa e sem espaço sobrando. */
function nameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function groupStatusesByName(statuses: BoardStatus[], boards: Board[]): SpaceColumn[] {
  const boardName = new Map(boards.map((b) => [b.id, b.name]));

  type Bucket = {
    column: SpaceColumn;
    /** Soma e contagem das posições, para ordenar as colunas depois. */
    orderSum: number;
    orderCount: number;
    firstSeen: number;
  };
  const buckets = new Map<string, Bucket>();

  statuses.forEach((status, index) => {
    const key = nameKey(status.name);
    const existing = buckets.get(key);

    if (existing) {
      existing.column.statusByBoard.set(status.board_id, status.id);
      existing.column.statusIds.add(status.id);
      const name = boardName.get(status.board_id);
      if (name && !existing.column.boardNames.includes(name)) existing.column.boardNames.push(name);
      existing.orderSum += status.sort_order;
      existing.orderCount += 1;
      return;
    }

    const name = boardName.get(status.board_id);
    buckets.set(key, {
      column: {
        id: `col-${key}`,
        name: status.name,
        color: status.color,
        statusByBoard: new Map([[status.board_id, status.id]]),
        statusIds: new Set([status.id]),
        boardNames: name ? [name] : [],
      },
      orderSum: status.sort_order,
      orderCount: 1,
      firstSeen: index,
    });
  });

  /*
   * A ordem é a média das posições que o status ocupa nos quadros onde existe.
   * A média, e não a menor: um "Concluído" que num quadro pequeno é o primeiro
   * status não pode por isso abrir o quadro do espaço inteiro. Empate volta
   * para a ordem em que os status apareceram.
   */
  return [...buckets.values()]
    .sort((a, b) => {
      const diff = a.orderSum / a.orderCount - b.orderSum / b.orderCount;
      return diff !== 0 ? diff : a.firstSeen - b.firstSeen;
    })
    .map(({ column }) => ({
      ...column,
      hint:
        column.boardNames.length > 1
          ? `“${column.name}” em ${column.boardNames.length} quadros: ${column.boardNames.join(", ")}`
          : `“${column.name}” em ${column.boardNames[0] ?? "—"}`,
    }));
}

/** Coluna em que a tarefa cai — a que contém o status dela. */
export function columnOfTask(columns: SpaceColumn[], task: Task): string | null {
  if (!task.status_id) return null;
  return columns.find((col) => col.statusIds.has(task.status_id!))?.id ?? null;
}
