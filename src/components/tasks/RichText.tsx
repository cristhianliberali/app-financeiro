import { useRef, type ReactNode } from "react";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, AtSign } from "lucide-react";
import type { AccountUser } from "@/lib/tasks";

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------
// O conteúdo é guardado como markdown simples e renderizado em nós React
// (sem HTML bruto) para evitar injeção de marcação.

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|@[\p{L}\p{N}._-]+)/gu;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
        return <em key={key}>{part.slice(1, -1)}</em>;
      if (part.startsWith("`") && part.endsWith("`"))
        return (
          <code key={key} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        );
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const href = link[2]!;
        const safe = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
        return (
          <a
            key={key}
            href={safe}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {link[1]}
          </a>
        );
      }
      if (part.startsWith("@"))
        return (
          <span key={key} className="rounded bg-primary/10 px-1 font-medium text-primary">
            {part}
          </span>
        );
      return <span key={key}>{part}</span>;
    });
}

export function RichTextView({
  value,
  className = "",
}: {
  value: string | null;
  className?: string;
}) {
  if (!value?.trim()) {
    return <p className={`text-sm text-muted-foreground ${className}`}>Sem descrição.</p>;
  }

  const blocks: ReactNode[] = [];
  const lines = value.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item, `li-${i}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`b-${blocks.length}`} className="ml-5 list-decimal space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={`b-${blocks.length}`} className="ml-5 list-disc space-y-1">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);

    if (bullet) {
      if (!list || list.ordered) flush();
      list = list ?? { ordered: false, items: [] };
      list.items.push(bullet[1]!);
      return;
    }
    if (ordered) {
      if (!list || !list.ordered) flush();
      list = list ?? { ordered: true, items: [] };
      list.items.push(ordered[1]!);
      return;
    }
    flush();
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(
        <p
          key={`b-${index}`}
          className={level === 1 ? "text-base font-bold" : "text-sm font-semibold"}
        >
          {renderInline(heading[2]!, `h-${index}`)}
        </p>,
      );
      return;
    }
    if (!line.trim()) return;
    blocks.push(
      <p key={`b-${index}`} className="leading-relaxed">
        {renderInline(line, `p-${index}`)}
      </p>,
    );
  });
  flush();

  return <div className={`space-y-2 text-sm ${className}`}>{blocks}</div>;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

type Tool = {
  icon: typeof Bold;
  label: string;
  wrap?: [string, string];
  prefix?: string;
};

const TOOLS: Tool[] = [
  { icon: Bold, label: "Negrito", wrap: ["**", "**"] },
  { icon: Italic, label: "Itálico", wrap: ["*", "*"] },
  { icon: Heading2, label: "Título", prefix: "## " },
  { icon: List, label: "Lista", prefix: "- " },
  { icon: ListOrdered, label: "Lista numerada", prefix: "1. " },
  { icon: Link2, label: "Link", wrap: ["[", "](https://)"] },
];

export function RichTextEditor({
  value,
  onChange,
  users = [],
  rows = 6,
  placeholder = "Detalhe a atividade…",
}: {
  value: string;
  onChange: (value: string) => void;
  users?: AccountUser[];
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = (tool: Tool) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);

    if (tool.prefix) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const next = `${value.slice(0, lineStart)}${tool.prefix}${value.slice(lineStart)}`;
      onChange(next);
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(start + tool.prefix!.length, end + tool.prefix!.length);
      });
      return;
    }

    const [open, close] = tool.wrap!;
    const next = `${value.slice(0, start)}${open}${selected || tool.label.toLowerCase()}${close}${value.slice(end)}`;
    onChange(next);
    queueMicrotask(() => {
      el.focus();
      const caret = start + open.length + (selected || tool.label).length;
      el.setSelectionRange(caret, caret);
    });
  };

  const mention = (user: AccountUser) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const token = `@${user.name.replace(/\s+/g, "")} `;
    onChange(`${value.slice(0, at)}${token}${value.slice(at)}`);
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  return (
    <div className="overflow-hidden rounded-md border border-input">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-secondary/40 px-1 py-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            onClick={() => apply(tool)}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <tool.icon className="size-3.5" />
          </button>
        ))}
        {users.length > 0 && (
          <div className="group relative">
            <button
              type="button"
              title="Mencionar pessoa"
              aria-label="Mencionar pessoa"
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <AtSign className="size-3.5" />
            </button>
            <div className="absolute left-0 top-full z-30 hidden max-h-48 w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md group-hover:block group-focus-within:block">
              {users.map((u) => (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => mention(u)}
                  className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y bg-card px-3 py-2 text-sm outline-none"
      />
    </div>
  );
}
