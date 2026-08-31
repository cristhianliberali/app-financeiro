import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlarmClock,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  LayoutDashboard,
  Loader,
  Plus,
  Sun,
  Timer,
} from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { AgendaCalendar } from "@/components/tasks/AgendaCalendar";
import { MyDay } from "@/components/tasks/MyDay";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { Button } from "@/components/ui/button";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useNow } from "@/hooks/use-now";
import { useTone } from "@/hooks/use-tone";
import {
  useBoardStatuses,
  useBoards,
  useSpaces,
  useTasks,
  useAccountTimeEntries,
  type Task,
} from "@/lib/tasks";
import { toISODate } from "@/lib/format";
import {
  PALETTE,
  PRIORITIES,
  deadlineState,
  estimateClass,
  estimateState,
  formatDuration,
  formatHours,
  hoursOf,
  todayKey,
  dayKey,
} from "@/lib/tasks-analytics";
import { DateField } from "@/components/ui/date-field";
import { DEFAULT_SPACE_ICON, IconBadge } from "@/lib/icons";

/** Estado do retorno do consentimento do Google (`/api/google/callback`). */
type Search = { agenda?: string | undefined };

export const Route = createFileRoute("/tarefas/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    agenda: typeof search["agenda"] === "string" ? search["agenda"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Projetos e Tarefas — Aura" },
      {
        name: "description",
        content:
          "Dashboard de tarefas, prazos e produtividade: tarefas em andamento, atrasadas, concluídas e tempo trabalhado por período.",
      },
      { property: "og:title", content: "Projetos e Tarefas — Aura" },
      {
        property: "og:description",
        content: "Gestão de projetos, atividades, responsáveis, prazos e produtividade.",
      },
    ],
  }),
  component: TasksDashboard,
});

/** Abas do painel: a visão consolidada, o dia de hoje e o calendário. */
type TabKey = "geral" | "dia" | "calendario";

const TABS = [
  ["geral", "Visão geral", LayoutDashboard],
  ["dia", "Meu dia", Sun],
  ["calendario", "Calendário", CalendarDays],
] as const satisfies ReadonlyArray<readonly [TabKey, string, typeof LayoutDashboard]>;

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus:ring-1 focus:ring-ring";

type RangeKey = "today" | "7d" | "month" | "custom";

function rangeOf(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  if (key === "today") return { from: today, to: today };
  if (key === "7d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { from: toISODate(start), to: today };
  }
  return {
    from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function Indicator({
  icon: Icon,
  label,
  value,
  hint,
  tone = "",
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="panel-interactive p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="label-caps">{label}</p>
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
            tone.includes("negative")
              ? "bg-negative-soft text-negative-soft-foreground"
              : tone.includes("positive")
                ? "bg-positive-soft text-positive-soft-foreground"
                : "bg-primary-soft text-primary"
          }`}
        >
          <Icon className="size-4" strokeWidth={2.25} />
        </span>
      </div>
      <p className={`stat-figure ${tone}`}>{value}</p>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h4 className="mb-4 text-base font-bold tracking-tight">{title}</h4>
      {children}
    </div>
  );
}

function TasksDashboard() {
  const { accountId, users, currentUserId } = useTasksModule();
  const now = useNow(30_000);
  const tone = useTone();
  const [rangeKey, setRangeKey] = useState<RangeKey>("month");
  const [custom, setCustom] = useState(() => rangeOf("month"));
  const [spaceId, setSpaceId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [tab, setTab] = useState<TabKey>("geral");
  const { agenda: agendaResult } = Route.useSearch();
  /** Tarefa aberta a partir do "Meu dia" ou do calendário. */
  const [selected, setSelected] = useState<Task | null>(null);

  const range = rangeKey === "custom" ? custom : rangeOf(rangeKey);

  // O Google devolve o usuário para cá depois do consentimento; a tela conta o
  // que aconteceu e limpa o parâmetro para o aviso não repetir a cada recarga.
  const navigate = useNavigate();
  useEffect(() => {
    if (!agendaResult) return;
    const messages: Record<string, () => void> = {
      conectado: () => toast.success("Google Agenda conectado"),
      recusado: () => toast.info("Conexão com o Google Agenda cancelada"),
      sessao: () => toast.error("Sessão expirada durante a conexão. Entre e tente de novo."),
      invalido: () => toast.error("O retorno do Google não pôde ser validado. Tente de novo."),
      falhou: () => toast.error("Não foi possível concluir a conexão com o Google Agenda."),
      banco: () =>
        toast.error(
          "O banco ainda não tem as tabelas da agenda. Rode `bun run db:migrate` no servidor.",
          { duration: 12000 },
        ),
    };
    (messages[agendaResult] ?? (() => {}))();
    if (agendaResult === "conectado") setTab("calendario");
    void navigate({ to: "/tarefas", search: {}, replace: true });
  }, [agendaResult, navigate]);

  const { data: statusesOfSelected = [] } = useBoardStatuses(selected?.board_id ?? null);
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const { data: allTasks = [] } = useTasks({ accountId });
  const { data: entries = [] } = useAccountTimeEntries({
    accountId,
    from: range.from,
    to: range.to,
  });

  const tasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          (!spaceId || t.space.id === spaceId) &&
          (!boardId || t.board_id === boardId) &&
          (!responsible || t.responsible_user_id === responsible),
      ),
    [allTasks, spaceId, boardId, responsible],
  );

  const filteredEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!spaceId || e.space_id === spaceId) &&
          (!boardId || e.board_id === boardId) &&
          (!responsible || e.user_id === responsible),
      ),
    [entries, spaceId, boardId, responsible],
  );

  const secondsOf = (e: (typeof filteredEntries)[number]) =>
    e.duration_seconds ?? Math.floor((now - new Date(e.started_at).getTime()) / 1000);

  const today = todayKey();

  const metrics = useMemo(() => {
    let inProgress = 0;
    let done = 0;
    let late = 0;
    let dueToday = 0;
    for (const task of tasks) {
      const polarity = task.status?.polarity ?? null;
      if (polarity === "IN_PROGRESS") inProgress++;
      if (polarity === "SUCCESS") done++;
      const state = deadlineState({ due_date: task.due_date, polarity });
      if (state === "late") late++;
      if (state === "due_today" || dayKey(task.start_date) === today) dueToday++;
    }
    return { inProgress, done, late, dueToday };
  }, [tasks, today]);

  const timeToday = filteredEntries
    .filter((e) => e.user_id === currentUserId && dayKey(e.started_at) === today)
    .reduce((sum, e) => sum + secondsOf(e), 0);

  const timePeriod = filteredEntries.reduce((sum, e) => sum + secondsOf(e), 0);

  const sumBy = <K extends string>(key: (e: (typeof filteredEntries)[number]) => K) => {
    const map = new Map<K, number>();
    for (const e of filteredEntries) map.set(key(e), (map.get(key(e)) ?? 0) + secondsOf(e));
    return map;
  };

  const byDay = useMemo(() => {
    const map = sumBy((e) => dayKey(e.started_at) ?? "");
    return [...map.entries()]
      .filter(([day]) => day)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, seconds]) => ({
        label: day.slice(8, 10) + "/" + day.slice(5, 7),
        horas: hoursOf(seconds),
      }));
  }, [filteredEntries, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const byUser = useMemo(() => {
    const map = sumBy((e) => e.user_id);
    return [...map.entries()]
      .map(([id, seconds]) => ({
        label: users.find((u) => u.user_id === id)?.name ?? "Usuário",
        horas: hoursOf(seconds),
      }))
      .sort((a, b) => b.horas - a.horas);
  }, [filteredEntries, users, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const byBoard = useMemo(() => {
    const map = sumBy((e) => e.board_name);
    return [...map.entries()]
      .map(([label, seconds]) => ({ label, horas: hoursOf(seconds) }))
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 8);
  }, [filteredEntries, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const bySpace = useMemo(() => {
    const map = sumBy((e) => e.space_name);
    return [...map.entries()]
      .map(([label, seconds]) => ({ label, horas: hoursOf(seconds) }))
      .sort((a, b) => b.horas - a.horas);
  }, [filteredEntries, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const byStatus = useMemo(() => {
    const map = new Map<string, { value: number; color: string }>();
    for (const task of tasks) {
      const name = task.status?.name ?? "Sem status";
      const color = tone(task.status?.color ?? "#8A8A8A");
      const current = map.get(name);
      map.set(name, { value: (current?.value ?? 0) + 1, color });
    }
    return [...map.entries()].map(([name, v]) => ({ name, value: v.value, color: v.color }));
  }, [tasks, tone]);

  /**
   * Estimado x realizado. O realizado vem do tempo cronometrado na própria
   * tarefa (não dos registros do período), para que a comparação seja sempre
   * entre a estimativa da tarefa e todo o esforço que ela já consumiu.
   */
  const estimates = useMemo(() => {
    let estimated = 0;
    let trackedOnEstimated = 0;
    let withEstimate = 0;
    let over = 0;
    for (const task of tasks) {
      if (!task.estimate_hours) continue;
      withEstimate++;
      estimated += task.estimate_hours;
      trackedOnEstimated += hoursOf(task.trackedSeconds);
      if (estimateState(task.estimate_hours, task.trackedSeconds) === "over") over++;
    }
    return {
      estimated,
      tracked: Math.round(trackedOnEstimated * 100) / 100,
      withEstimate,
      without: tasks.length - withEstimate,
      over,
      balance: Math.round((estimated - trackedOnEstimated) * 100) / 100,
    };
  }, [tasks]);

  /** Estimado x realizado por quadro — onde o esforço está estourando. */
  const estimateByBoard = useMemo(() => {
    const map = new Map<string, { estimado: number; realizado: number }>();
    for (const task of tasks) {
      if (!task.estimate_hours) continue;
      const current = map.get(task.board.name) ?? { estimado: 0, realizado: 0 };
      map.set(task.board.name, {
        estimado: current.estimado + task.estimate_hours,
        realizado: current.realizado + hoursOf(task.trackedSeconds),
      });
    }
    return [...map.entries()]
      .map(([label, value]) => ({
        label,
        estimado: Math.round(value.estimado * 100) / 100,
        realizado: Math.round(value.realizado * 100) / 100,
      }))
      .sort((a, b) => b.estimado - a.estimado)
      .slice(0, 8);
  }, [tasks]);

  const byPriority = useMemo(
    () =>
      // Sem `tone` aqui: a cor da prioridade é escolhida, não é um tom da paleta
      // cinza — espelhá-la no tema escuro trocaria vermelho por verde-água.
      PRIORITIES.map((option) => ({
        name: option.label,
        color: option.color,
        value: tasks.filter((task) => task.priority === option.value).length,
      })).filter((row) => row.value > 0),
    [tasks],
  );

  const byResponsible = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      const name = task.responsible_user_id
        ? (users.find((u) => u.user_id === task.responsible_user_id)?.name ?? "Usuário")
        : "Sem responsável";
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([label, tarefas]) => ({ label, tarefas }))
      .sort((a, b) => b.tarefas - a.tarefas);
  }, [tasks, users]);

  const hasData = allTasks.length > 0;

  return (
    <TasksShell
      breadcrumbCurrent="Visão geral"
      actions={
        <Button size="sm" asChild>
          <Link to="/tarefas/espacos">
            <Plus className="mr-1 size-3.5" /> Espaços e quadros
          </Link>
        </Button>
      }
    >
      <div>
        <h1 className="title-xl">Projetos e Tarefas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão consolidada de todos os espaços e quadros aos quais você tem acesso.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary p-1">
        {TABS.map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              tab === value
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className={`size-4 ${tab === value ? "text-primary" : ""}`} />
            {label}
          </button>
        ))}
      </div>

      {tab === "dia" && (
        <MyDay
          tasks={allTasks}
          currentUserId={currentUserId}
          accountId={accountId}
          onOpenTask={setSelected}
        />
      )}

      {tab === "calendario" && <AgendaCalendar tasks={allTasks} onOpenTask={setSelected} />}

      {selected && (
        <TaskDialog
          open
          onOpenChange={(open) => !open && setSelected(null)}
          task={selected}
          boardId={selected.board_id}
          statuses={statusesOfSelected}
          users={users}
          currentUserId={currentUserId}
        />
      )}

      {tab === "geral" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {(
                [
                  ["today", "Hoje"],
                  ["7d", "Últimos 7 dias"],
                  ["month", "Este mês"],
                  ["custom", "Personalizado"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRangeKey(value)}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    rangeKey === value
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {rangeKey === "custom" && (
              <>
                <DateField
                  className="h-9 w-36"
                  aria-label="Início do período"
                  value={custom.from}
                  onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                />
                <DateField
                  className="h-9 w-36"
                  aria-label="Fim do período"
                  value={custom.to}
                  onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                />
              </>
            )}
            <select
              className={SELECT_CLASS}
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value);
                setBoardId("");
              }}
            >
              <option value="">Todos os espaços</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className={SELECT_CLASS}
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            >
              <option value="">Todos os quadros</option>
              {boards
                .filter((b) => !spaceId || b.space_id === spaceId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
            <select
              className={SELECT_CLASS}
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            >
              <option value="">Todos os responsáveis</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Indicator
              icon={Loader}
              label="Em andamento"
              value={String(metrics.inProgress)}
              hint="Polaridade em andamento"
            />
            <Indicator
              icon={CheckCircle2}
              label="Concluídas"
              value={String(metrics.done)}
              hint="Polaridade sucesso"
              tone="text-positive"
            />
            <Indicator
              icon={AlarmClock}
              label="Atrasadas"
              value={String(metrics.late)}
              hint="Prazo vencido sem conclusão"
              tone="text-negative"
            />
            <Indicator
              icon={CalendarCheck}
              label="Para hoje"
              value={String(metrics.dueToday)}
              hint="Início ou prazo hoje"
            />
            <Indicator
              icon={Clock}
              label="Meu tempo hoje"
              value={formatDuration(timeToday)}
              hint="Seus registros de hoje"
            />
            <Indicator
              icon={Clock}
              label="Tempo no período"
              value={formatDuration(timePeriod)}
              hint={`${range.from.slice(8, 10)}/${range.from.slice(5, 7)} a ${range.to.slice(8, 10)}/${range.to.slice(5, 7)}`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicator
              icon={Timer}
              label="Horas estimadas"
              value={formatHours(estimates.estimated)}
              hint={`${estimates.withEstimate} tarefa(s) com estimativa · ${estimates.without} sem`}
            />
            <Indicator
              icon={Clock}
              label="Realizado nelas"
              value={formatHours(estimates.tracked)}
              hint="Tempo cronometrado nas tarefas estimadas"
            />
            <Indicator
              icon={Timer}
              label={estimates.balance >= 0 ? "Saldo de horas" : "Horas excedidas"}
              value={formatHours(Math.abs(estimates.balance))}
              hint={estimates.balance >= 0 ? "Ainda dentro do estimado" : "Acima do estimado"}
              tone={estimates.balance >= 0 ? "" : "text-negative"}
            />
            <Indicator
              icon={AlarmClock}
              label="Estouraram a estimativa"
              value={String(estimates.over)}
              hint="Tarefas com tempo acima do estimado"
              tone={estimates.over > 0 ? "text-negative" : ""}
            />
          </div>

          {!hasData && (
            <div className="panel brand-sheen p-12 text-center">
              <p className="text-sm font-semibold">Nenhuma tarefa ainda</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Crie um espaço, um quadro e comece a registrar atividades.
              </p>
              <Button className="mt-4" asChild>
                <Link to="/tarefas/espacos">Criar meu primeiro espaço</Link>
              </Button>
            </div>
          )}

          {hasData && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Horas registradas por dia">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byDay}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} />
                    <Tooltip formatter={(v: number) => `${v} h`} />
                    <Bar dataKey="horas" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="Horas por usuário">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byUser} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={100}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <Tooltip formatter={(v: number) => `${v} h`} />
                    <Bar dataKey="horas" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="Horas por quadro">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byBoard} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={120}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <Tooltip formatter={(v: number) => `${v} h`} />
                    <Bar dataKey="horas" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="Horas por espaço">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={bySpace} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={120}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <Tooltip formatter={(v: number) => `${v} h`} />
                    <Bar dataKey="horas" fill="var(--chart-5)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="Distribuição por status">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={byStatus}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {byStatus.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [`${v} tarefas`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {byStatus.map((s) => (
                    <span key={s.name} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name} · {s.value}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel title="Estimado x realizado por quadro">
                {estimateByBoard.length === 0 ? (
                  <p className="py-14 text-center text-sm text-muted-foreground">
                    Nenhuma tarefa com estimativa de horas ainda. Informe a estimativa dentro da
                    tarefa para acompanhar aqui.
                  </p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={estimateByBoard} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={120}
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                        />
                        <Tooltip formatter={(v: number) => `${v} h`} />
                        <Bar dataKey="estimado" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="realizado" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-chart-4" /> Estimado
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-chart-1" /> Realizado
                      </span>
                    </div>
                  </>
                )}
              </Panel>

              <Panel title="Distribuição por prioridade">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={byPriority}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {byPriority.map((row) => (
                        <Cell key={row.name} fill={row.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [`${v} tarefas`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {byPriority.map((row) => (
                    <span key={row.name} className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.name} · {row.value}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel title="Tarefas por responsável">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byResponsible} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={110}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <Tooltip formatter={(v: number) => `${v} tarefas`} />
                    <Bar dataKey="tarefas" radius={[0, 4, 4, 0]}>
                      {byResponsible.map((_, i) => (
                        <Cell
                          key={i}
                          fill={tone(PALETTE[i % PALETTE.length]!)}
                          stroke="var(--color-card)"
                          strokeWidth={2}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>
          )}

          {spaces.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Acesso rápido</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {spaces
                  .filter((s) => !s.archived_at)
                  .map((space) => (
                    <Link
                      key={space.id}
                      to="/tarefas/espacos/$spaceId"
                      params={{ spaceId: space.id }}
                      className="panel-interactive flex items-center gap-3 p-4"
                    >
                      <IconBadge
                        name={space.icon}
                        color={space.color}
                        fallback={DEFAULT_SPACE_ICON}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{space.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {boards.filter((b) => b.space_id === space.id).length} quadros
                        </p>
                      </div>
                    </Link>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </TasksShell>
  );
}
