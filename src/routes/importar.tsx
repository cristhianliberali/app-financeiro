import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { DocumentImportPanel } from "@/components/DocumentImportPanel";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar com IA — Aura Finanças" },
      {
        name: "description",
        content:
          "Leia faturas e extratos em PDF, OFX, CSV ou Excel, confira os lançamentos detectados e categorize com IA antes de lançar.",
      },
      { property: "og:title", content: "Importar com IA — Aura Finanças" },
      {
        property: "og:description",
        content: "Leitura de faturas e extratos com conferência de totais e categorização por IA.",
      },
    ],
  }),
  component: ImportPage,
});

/**
 * Importação de fatura/extrato, em tela cheia.
 *
 * A revisão de uma fatura é uma sessão de trabalho — dezenas de linhas para
 * conferir contra o documento —, e isso não cabe num diálogo por cima do app.
 * Como tela, ela tem endereço próprio, largura inteira e guarda o que está em
 * revisão: sair para olhar as transações e voltar não custa a leitura.
 *
 * A barra de período não aparece: aqui não se lê um recorte de tempo, se lê um
 * documento.
 */
function ImportPage() {
  return (
    <AppShell showPeriodBar={false}>
      <div>
        <h1 className="title-xl">Importar com IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O app lê o documento por conta própria e confere os totais que ele declara. A IA entra
          depois, só para sugerir categorias — e recebe apenas as descrições, nunca o arquivo.
        </p>
      </div>

      <DocumentImportPanel />
    </AppShell>
  );
}
