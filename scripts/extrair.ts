/**
 * Diagnóstico da extração determinística, direto no terminal:
 *
 *   bun run extrair caminho/para/fatura.pdf
 *
 * Roda o mesmo caminho da tela de importação (camadas 1, 2 e 4 — nenhuma
 * requisição de IA) e imprime o que ela mostraria: transações, conferência dos
 * totais, alertas e linhas não interpretadas. É a ferramenta para testar a
 * fatura de um banco novo em segundos: o que sair errado aqui vira fixture
 * anonimizada e correção genérica no pipeline.
 */
import { extrairParaTela } from "../src/integrations/ai/pipeline/extracao.server";

const caminho = process.argv[2];
if (!caminho) {
  console.error("Uso: bun run extrair <arquivo.pdf|ofx|csv|txt>");
  process.exit(1);
}

const bytes = new Uint8Array(await Bun.file(caminho).arrayBuffer());
const nome = caminho.split("/").pop() ?? caminho;
const extracao = await extrairParaTela({
  file: { name: nome, base64: Buffer.from(bytes).toString("base64") },
});

const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

console.log(
  `${nome} · ${extracao.origem} · ${extracao.estatisticas.paginas} página(s) · ` +
    `${extracao.estatisticas.linhas} linhas · convenção ${extracao.convencao}`,
);
console.log(
  `período ${extracao.periodo.inicio ?? "?"} a ${extracao.periodo.fim ?? "?"} · ` +
    `vencimento ${extracao.vencimento ?? "?"}`,
);
console.log("");

for (const transacao of extracao.transacoes) {
  console.log(
    [
      String(transacao.linhaId).padStart(4),
      transacao.dataIso ?? "----------",
      (transacao.kind === "income" ? "+" : "-") + brl(transacao.valor).padStart(13),
      transacao.estorno ? "EST" : "   ",
      transacao.parcela
        ? `${transacao.parcela.numero}/${transacao.parcela.total}`.padStart(5)
        : "     ",
      transacao.descricao || "(sem descrição)",
      transacao.avisos.length > 0 ? `[${transacao.avisos.join(", ")}]` : "",
    ].join("  "),
  );
}

const entradas = extracao.transacoes
  .filter((transacao) => transacao.kind === "income")
  .reduce((soma, transacao) => soma + transacao.valor, 0);
const saidas = extracao.transacoes
  .filter((transacao) => transacao.kind === "expense")
  .reduce((soma, transacao) => soma + transacao.valor, 0);

console.log("");
console.log(
  `${extracao.transacoes.length} transações · entradas ${brl(entradas)} · saídas ${brl(saidas)}`,
);

if (extracao.conferencia.disponivel) {
  for (const total of extracao.conferencia.totais.filter((total) => total.conferivel)) {
    console.log(
      `${total.fechou ? "✔" : "✘"} ${total.rotulo} = ${brl(total.valor)}` +
        (total.fechou ? ` (via ${total.via})` : ` — faltam ${brl(Math.abs(total.diferenca))}`),
    );
  }
} else {
  console.log("(documento sem total conferível — conferência de soma não se aplica)");
}

for (const alerta of extracao.conferencia.alertas) console.log(`⚠ ${alerta.mensagem}`);

if (extracao.naoInterpretadas.length > 0) {
  console.log(`\n${extracao.naoInterpretadas.length} linha(s) não interpretadas:`);
  for (const linha of extracao.naoInterpretadas) {
    console.log(`  · ${linha.texto.length > 100 ? `${linha.texto.slice(0, 100)}…` : linha.texto}`);
  }
}
