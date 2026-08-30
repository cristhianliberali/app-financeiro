import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileDialog } from "@/components/ProfileDialog";
import { useAuth } from "@/hooks/useAuth";

/** Iniciais do nome (ou do e-mail, quando não há nome cadastrado). */
function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Ícone do perfil no rodapé das laterais dos dois módulos.
 *
 * É o ponto de entrada das preferências pessoais (nome, e-mail e senha) — o que
 * antes só existia como um botão "Sair" solto no canto.
 */
export function ProfileMenu({
  /** Só o ícone, para a lateral recolhida. */
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          // `min-w-0` é o que deixa o botão encolher: sem ele, um e-mail longo
          // empurra o seletor de tema para fora da lateral, por cima do conteúdo.
          className={`flex min-w-0 items-center gap-2 rounded-lg text-left transition-colors hover:bg-secondary ${
            collapsed ? "shrink-0 justify-center p-1" : "w-full p-1.5"
          }`}
          aria-label="Meu perfil"
          title={user.name ?? user.email}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials(user.name, user.email)}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {user.name?.trim() || "Meu perfil"}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <Settings className="mr-2 size-4" /> Meu perfil
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: "/conta" })}>
            <Users className="mr-2 size-4" /> Conta &amp; equipe
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="mr-2 size-4" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
