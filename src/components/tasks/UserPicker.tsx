import { useMemo, useState } from "react";
import { Check, ChevronDown, UserPlus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import type { AccountUser } from "@/lib/tasks";
import { avatarColor, initialsOf } from "@/lib/tasks-analytics";

export function UserAvatar({
  user,
  size = 24,
  title,
}: {
  user: AccountUser | { user_id: string; name: string } | null;
  size?: number;
  title?: string;
}) {
  if (!user) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title={title ?? "Sem responsável"}
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: avatarColor(user.user_id),
      }}
      title={title ?? user.name}
    >
      {initialsOf(user.name)}
    </span>
  );
}

export function UserStack({
  ids,
  users,
  max = 4,
  size = 22,
}: {
  ids: string[];
  users: AccountUser[];
  max?: number;
  size?: number;
}) {
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((id) => {
        const user = users.find((u) => u.user_id === id) ?? null;
        return (
          <span key={id} className="ring-2 ring-card rounded-full">
            <UserAvatar user={user ?? { user_id: id, name: "?" }} size={size} />
          </span>
        );
      })}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-secondary text-[10px] font-semibold ring-2 ring-card"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

function useFiltered(users: AccountUser[], term: string) {
  return useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(t) || (u.email ?? "").toLowerCase().includes(t),
    );
  }, [users, term]);
}

/** Seleção de um único usuário (responsável). */
export function UserSelect({
  users,
  value,
  onChange,
  placeholder = "Sem responsável",
  allowEmpty = true,
}: {
  users: AccountUser[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const filtered = useFiltered(users, term);
  const selected = users.find((u) => u.user_id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors hover:bg-secondary focus:ring-1 focus:ring-ring">
        {selected ? (
          <>
            <UserAvatar user={selected} size={20} />
            <span className="truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDown className="ml-auto size-3 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar pessoa…"
            className="h-8"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {allowEmpty && (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-border text-[10px]">
                ?
              </span>
              {placeholder}
              {!value && <Check className="ml-auto size-3" />}
            </button>
          )}
          {filtered.map((u) => (
            <button
              key={u.user_id}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
              onClick={() => {
                onChange(u.user_id);
                setOpen(false);
              }}
            >
              <UserAvatar user={u} size={20} />
              <span className="truncate">{u.name}</span>
              {value === u.user_id && <Check className="ml-auto size-3 shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nenhuma pessoa encontrada
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Seleção de vários usuários (participantes, acesso ao espaço). */
export function UserMultiSelect({
  users,
  value,
  onChange,
  label = "Adicionar pessoa",
}: {
  users: AccountUser[];
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const filtered = useFiltered(users, term);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const user = users.find((u) => u.user_id === id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-0.5 pr-2 text-xs"
          >
            <UserAvatar user={user ?? { user_id: id, name: "?" }} size={18} />
            {user?.name ?? "Usuário"}
            <button
              onClick={() => toggle(id)}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label={`Remover ${user?.name ?? "usuário"}`}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <UserPlus className="size-3" /> {label}
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar pessoa…"
              className="h-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.map((u) => (
              <button
                key={u.user_id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                onClick={() => toggle(u.user_id)}
              >
                <UserAvatar user={u} size={20} />
                <span className="truncate">{u.name}</span>
                {value.includes(u.user_id) && <Check className="ml-auto size-3 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                Nenhuma pessoa encontrada
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
