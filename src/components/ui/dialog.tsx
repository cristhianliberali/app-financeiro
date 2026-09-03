"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-foreground/45 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Diálogo do sistema — folha no celular, cartão centrado no desktop.
 *
 * A forma muda porque o problema é outro em cada tela. No desktop sobra altura
 * e o cartão centrado é o gesto certo: ele flutua sobre a página e a página
 * continua visível em volta. No celular não sobra nada — o cartão centrado
 * ficava maior que a janela, e como não havia limite de altura ele vazava pelo
 * topo e pelo rodapé ao mesmo tempo. O resultado era um diálogo que cobria a
 * tela inteira: o X do canto ficava acima da área visível, não havia véu
 * sobrando para tocar fora, e não havia como rolar até um botão. Um diálogo do
 * qual não se sai.
 *
 * Três garantias resolvem isso, e valem para todo diálogo do app porque moram
 * aqui e não em cada chamada:
 *
 * 1. **Altura sempre menor que a janela.** `dvh`, e não `vh`: no celular a
 *    barra de endereço entra e sai, e `vh` mede a janela sem ela — 92vh de
 *    altura com a barra à mostra já é mais do que cabe.
 * 2. **A rolagem é interna.** O conteúdo rola dentro do diálogo; o quadro em
 *    volta — e o X dentro dele — fica parado. Antes o botão de fechar rolava
 *    junto com o conteúdo e sumia.
 * 3. **Sempre há véu para tocar.** Ancorado no rodapé, o topo da janela fica
 *    livre; tocar ali fecha, como em qualquer folha de celular.
 *
 * A largura continua sendo assunto de quem chama (`sm:max-w-2xl` e afins). A
 * altura não é: quem escrever `max-h-[92vh]` numa chamada está desfazendo a
 * primeira garantia sem perceber.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden border border-border bg-card shadow-xl duration-200",
        // Celular: folha ancorada no rodapé, colada nas laterais. O canto
        // arredondado só em cima é o que diz "isto subiu do rodapé".
        "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl px-4 pb-4 pt-3",
        // Desktop: cartão centrado, com folga garantida em volta.
        "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100%-3rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {/* Pega-mão: a pista visual de que isto é uma folha e sai por baixo. */}
      <div
        aria-hidden
        className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden"
      />
      {/*
        A caixa que rola. `min-h-0` é o que a faz rolar de verdade: um filho de
        flex não encolhe abaixo do próprio conteúdo sem isso, e a rolagem
        vazaria de novo para fora do diálogo.

        `overflow-x-hidden` porque abrir um eixo promove o outro a `auto` no
        CSS. O que for largo de verdade lá dentro — uma imagem grande, um bloco
        de log — traz o próprio scroller.
      */}
      <div className="grid min-h-0 flex-1 auto-rows-min gap-5 overflow-y-auto overflow-x-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">
        {children}
      </div>
      {/*
        Fora da caixa que rola, de propósito: o botão de sair não pode depender
        de onde o conteúdo está. Alvo de 40px no dedo, com fundo próprio para
        não se perder sobre o texto que passa por baixo.
      */}
      <DialogPrimitive.Close className="absolute right-3 top-3 flex size-10 cursor-pointer items-center justify-center rounded-full bg-card/85 text-muted-foreground opacity-90 ring-offset-background backdrop-blur transition hover:bg-accent hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:right-4 sm:top-4 sm:size-8">
        <X className="size-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // Alinhado à esquerda também no celular: título centrado numa folha larga
  // fica órfão, e a descrição embaixo dele nunca centra bem.
  <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/**
 * Rodapé do diálogo.
 *
 * No celular os botões empilham em largura cheia — `flex-col-reverse` põe a
 * ação principal por cima do "Cancelar", como em qualquer folha de celular, e
 * a largura cheia vem sozinha do `align-items: stretch` do flex. Um botão da
 * largura da tela é o alvo mais fácil que existe para o polegar.
 *
 * `sticky` vale em qualquer largura, e não só no celular: quem decide se o
 * rodapé sai da vista não é a largura da tela, é a altura. Num telefone deitado
 * (844×390) o diálogo já entra na forma de cartão e mesmo assim a janela é
 * baixa demais — o "Salvar" ficava depois de uma rolagem interna que nada
 * anuncia. Preso embaixo, a ação principal está sempre a um toque.
 *
 * A borda no topo separa o rodapé do conteúdo que passa por baixo dele. Ela
 * fica só na folha do celular, onde o diálogo tem sempre a altura da janela e
 * a rolagem interna é a regra, não a exceção.
 */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "sticky bottom-0 flex flex-col-reverse gap-2 border-t border-border bg-card pb-1 pt-3",
      "sm:flex-row sm:justify-end sm:border-t-0 sm:pb-0",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    // `pr-10` abre espaço para o botão de fechar: sem isso um título longo
    // passa por baixo dele. Fica no título, e não no cabeçalho, porque metade
    // dos diálogos do app usa `DialogTitle` solto, sem `DialogHeader`.
    className={cn("pr-10 text-base font-bold leading-tight tracking-tight sm:text-lg", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
