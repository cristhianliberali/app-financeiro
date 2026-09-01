import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileUp,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppState } from "@/lib/app-state";
import { activeCategories, useCategories, useUpsert } from "@/lib/data";
import {
  ACCEPTED_UPLOAD,
  categorizeDocument,
  extractDocument,
  learnMerchantLabels,
  type ExtracaoParaTela,
  type TransacaoExtraida,
} from "@/lib/document-import.functions";
import { getImportConfig } from "@/lib/ai-import.functions";
import { brl, formatDateBR } from "@/lib/format";

/** Uma transação extraída, com o que a tela deixa ajustar antes de lançar. */
type Draft = TransacaoExtraida & {
  include: boolean;
  category_id: string;
  /** Data editável; nasce da `dataIso` que o parser resolveu. */
  data: string;
  /** Categoria sugerida na etapa de IA, com a confiança devolvida. */
  ia: { confianca: number; origem: "cache" | "ia" } | null;
};

const ORIGEM_LABEL: Record<ExtracaoParaTela["origem"], string> = {
  pdf_texto: "PDF",
  ocr: "OCR",
  csv: "CSV",
  ofx: "OFX",
  texto: "texto",
};

/**
 * Onde a leitura em andamento fica guardada entre visitas.
 *
 * Ler o documento custa tempo (e categorizar custa IA); trocar de aba para
 * conferir um lançamento antigo e voltar não pode jogar esse trabalho fora. O
 * rascunho vive no `localStorage` do navegador de quem importou, e só sai de lá
 * quando a pessoa lança ou clica em limpar.
 */
const STORAGE_KEY = "aura.importacao.rascunho";

type Rascunho = {
  /** Perfil a que o rascunho pertence: trocar de perfil não herda a leitura do outro. */
  profileId: string | null;
  extracao: ExtracaoParaTela;
  rows: Draft[];
  vencimento: string;
};

function lerRascunho(): Rascunho | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const cru: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!cru || typeof cru !== "object") return null;
    const rascunho = cru as Partial<Rascunho>;
    if (!rascunho.extracao || !Array.isArray(rascunho.rows)) return null;
    return {
      profileId: rascunho.profileId ?? null,
      extracao: rascunho.extracao,
      rows: rascunho.rows,
      vencimento: rascunho.vencimento ?? "",
    };
  } catch {
    // Rascunho corrompido não pode impedir a tela de abrir.
    return null;
  }
}

/** Lê o arquivo escolhido como base64, sem o prefixo `data:`. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/**
 * Importação de fatura/extrato em duas etapas, como tela.
 *
 * Etapa 1: o servidor extrai as transações por código e devolve tudo de uma vez
 * — nenhum dado do documento vai para IA. Etapa 2 (botão "Categorizar com IA"):
 * só as descrições numeradas e as categorias disponíveis vão para o modelo, que
 * devolve decisões.
 *
 * Era um diálogo, e isso limitava a revisão a uma janela rolável por cima do
 * app: conferir cem linhas contra a fatura pede a tela inteira, e sair para
 * olhar outra coisa não pode custar a leitura. Como tela, ela também tem
 * endereço próprio — dá para voltar a ela pelo histórico do navegador.
 */
export function DocumentImportPanel() {
  const { profileId } = useAppState();
  const { data: allCategories = [] } = useCategories(profileId);
  const categories = useMemo(() => activeCategories(allCategories), [allCategories]);
  const upsert = useUpsert("transactions");
  const extract = useServerFn(extractDocument);
  const categorize = useServerFn(categorizeDocument);
  const learn = useServerFn(learnMerchantLabels);
  const fileInput = useRef<HTMLInputElement>(null);

  // A extração não depende de IA; só o botão de categorizar precisa dela.
  const { data: config } = useQuery({
    queryKey: ["ai-import-config"],
    queryFn: () => getImportConfig(),
    staleTime: 5 * 60 * 1000,
  });

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracao, setExtracao] = useState<ExtracaoParaTela | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  /** Vencimento único do documento, aplicado a todas as linhas ao lançar. */
  const [vencimento, setVencimento] = useState("");
  const [categorizando, setCategorizando] = useState(false);
  const [showTotais, setShowTotais] = useState(false);
  const [showNaoInterpretadas, setShowNaoInterpretadas] = useState(false);
  const [busca, setBusca] = useState("");
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  /** Só depois de ler o rascunho é que vale gravar — senão o vazio inicial o apaga. */
  const [restaurado, setRestaurado] = useState(false);
  /** Perfil em que a leitura guardada foi feita, para avisar se ele mudou. */
  const [perfilDoRascunho, setPerfilDoRascunho] = useState<string | null>(null);

  // Volta a leitura guardada, uma vez, ao abrir a tela.
  useEffect(() => {
    const rascunho = lerRascunho();
    if (rascunho) {
      setExtracao(rascunho.extracao);
      setRows(rascunho.rows);
      setVencimento(rascunho.vencimento);
      setPerfilDoRascunho(rascunho.profileId);
    }
    setRestaurado(true);
  }, []);

  /*
   * Grava a cada mudança: sair da tela no meio da revisão não perde nada. O
   * perfil gravado é o da leitura, nunca o selecionado agora — sobrescrevê-lo
   * apagaria justamente o aviso de que a leitura veio de outro lugar.
   */
  useEffect(() => {
    if (!restaurado) return;
    try {
      if (!extracao) localStorage.removeItem(STORAGE_KEY);
      else {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            profileId: perfilDoRascunho,
            extracao,
            rows,
            vencimento,
          } satisfies Rascunho),
        );
      }
    } catch {
      // Sem espaço ou em aba privada: a revisão continua, só não sobrevive ao F5.
    }
  }, [restaurado, perfilDoRascunho, extracao, rows, vencimento]);

  /** Uma chamada só: o documento inteiro vira transações de uma vez. */
  async function start() {
    if (!profileId) return;
    setLoading(true);
    try {
      const resultado = await extract({
        data: {
          profileId,
          ...(file ? { file: { name: file.name, base64: await readAsBase64(file) } } : { text }),
        },
      });
      setExtracao(resultado);
      setPerfilDoRascunho(profileId);
      setVencimento(resultado.vencimento ?? "");
      setRows(
        resultado.transacoes.map((t) => ({
          ...t,
          include: true,
          category_id: "",
          data: t.dataIso ?? "",
          ia: null,
        })),
      );
      if (resultado.transacoes.length === 0) {
        toast.warning("Nenhuma transação com data e valor foi encontrada no documento.");
      } else {
        toast.success(
          `${resultado.transacoes.length} transações encontradas` +
            (resultado.conferencia.disponivel
              ? resultado.conferencia.fechouTudo
                ? " — os totais do documento conferem"
                : " — atenção: nem todos os totais fecharam"
              : ""),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao ler o documento");
    } finally {
      setLoading(false);
    }
  }

  function patch(linhaId: number, values: Partial<Draft>) {
    setRows((prev) => prev.map((r) => (r.linhaId === linhaId ? { ...r, ...values } : r)));
  }

  /** Descarta a leitura inteira — o único caminho que apaga o rascunho guardado. */
  function limpar() {
    setExtracao(null);
    setRows([]);
    setVencimento("");
    setBusca("");
    setText("");
    setFile(null);
    setPerfilDoRascunho(null);
    if (fileInput.current) fileInput.current.value = "";
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nada a fazer: o estado em memória já foi limpo.
    }
    toast.success("Registros pendentes descartados");
  }

  /**
   * Etapa 2: envia só os descritores numerados — a OpenAI recebe as categorias
   * disponíveis e devolve decisões (`id:codigo,confiança`). Nada do arquivo
   * sai daqui, e escolha manual já feita não é sobrescrita.
   */
  async function categorizar() {
    if (!profileId) return;
    const itens = rows
      .filter((r) => r.descricao.trim() !== "")
      .map((r) => ({ linhaId: r.linhaId, descricao: r.descricao, valor: r.valor, kind: r.kind }));
    if (itens.length === 0) {
      toast.error("Nenhuma transação com descrição para categorizar");
      return;
    }
    setCategorizando(true);
    try {
      const resposta = await categorize({ data: { profileId, itens } });
      const porLinha = new Map(resposta.decisoes.map((decisao) => [decisao.linhaId, decisao]));

      const novas = rows.map((r) => {
        const decisao = porLinha.get(r.linhaId);
        if (!decisao?.categoryId) return r;
        // Escolha manual já feita não é sobrescrita; sugestão anterior da IA, sim.
        if (r.category_id !== "" && r.ia === null) return r;
        return {
          ...r,
          category_id: decisao.categoryId,
          ia: { confianca: decisao.confianca, origem: decisao.origem },
        };
      });
      const aplicadas = novas.filter((r, i) => r !== rows[i]).length;
      setRows(novas);

      const semCategoria = itens.length - resposta.decisoes.filter((d) => d.categoryId).length;
      toast.success(
        `${aplicadas} transações categorizadas` +
          (resposta.doCache > 0 ? ` · ${resposta.doCache} do cache, sem custo` : "") +
          (semCategoria > 0 ? ` · ${semCategoria} para escolher à mão` : ""),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao categorizar com IA");
    } finally {
      setCategorizando(false);
    }
  }

  async function commit() {
    const selected = rows.filter((r) => r.include);
    if (!selected.length) {
      toast.error("Selecione ao menos uma transação");
      return;
    }
    const semData = selected.filter((r) => !r.data);
    if (semData.length > 0) {
      toast.error(
        semData.length === 1
          ? "1 transação selecionada está sem data. Preencha antes de lançar."
          : `${semData.length} transações selecionadas estão sem data. Preencha antes de lançar.`,
      );
      return;
    }
    // Categoria é obrigatória em todo lançamento; aqui ela chega em massa, e
    // avisar quantas faltam é mais útil do que reclamar de uma por vez.
    const semCategoria = selected.filter((r) => !r.category_id);
    if (semCategoria.length > 0) {
      toast.error(
        semCategoria.length === 1
          ? "1 transação selecionada está sem categoria. Escolha antes de lançar."
          : `${semCategoria.length} transações selecionadas estão sem categoria. Escolha antes de lançar.`,
        { description: "Use “Categorizar com IA” ou escolha na linha." },
      );
      return;
    }
    await upsert.mutateAsync(
      selected.map((r) => ({
        profile_id: profileId,
        description: r.parcela
          ? `${r.descricao} ${r.parcela.numero}/${r.parcela.total}`
          : r.descricao,
        amount: r.valor,
        kind: r.kind,
        transaction_date: r.data,
        due_date: vencimento || r.data,
        status: "pending",
        category_id: r.category_id,
        installment_no: r.parcela?.numero ?? null,
        installment_total: r.parcela?.total ?? null,
        installment_group: r.parcela ? crypto.randomUUID() : null,
      })),
    );
    // Cada confirmação vira rótulo: o cache de merchants aprende com a escolha
    // da pessoa, e a próxima fatura chega categorizada sem custo. Falha aqui
    // não atrapalha o lançamento — é aprendizado, não requisito.
    const rotulos = selected.flatMap((r) => {
      const categoria = categories.find((c) => c.id === r.category_id)?.name;
      return categoria ? [{ descricao: r.descricao, categoria }] : [];
    });
    if (rotulos.length > 0 && profileId) {
      learn({ data: { profileId, rotulos } }).catch(() => {});
    }
    toast.success(`${selected.length} transações lançadas`);
    // Lançou, acabou: o que ficou para trás não é mais pendência.
    const restantes = rows.filter((r) => !r.include);
    if (restantes.length === 0) {
      setExtracao(null);
      setRows([]);
      setVencimento("");
      setBusca("");
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Idem.
      }
    } else {
      setRows(restantes);
    }
  }

  const selected = rows.filter((r) => r.include);
  const totals = selected.reduce(
    (acc, row) => {
      if (row.kind === "income") acc.income += row.valor;
      else acc.expense += row.valor;
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const comAviso = rows.filter((r) => r.avisos.length > 0).length;
  const semCategoriaSelecionadas = selected.filter((r) => !r.category_id).length;
  // Só os totais conferíveis entram no veredito; limite, taxa e projeção são
  // declarações do documento, não somas das linhas.
  const conferiveis = extracao?.conferencia.totais.filter((t) => t.conferivel) ?? [];
  const informativos = (extracao?.conferencia.totais.length ?? 0) - conferiveis.length;
  const totaisAbertos = conferiveis.filter((t) => !t.fechou);
  const canStart = !!file || text.trim().length >= 10;

  /**
   * Busca nos lançamentos detectados.
   *
   * Numa fatura de cem linhas a pergunta quase sempre é uma só — "achou aquela
   * compra?" —, e rolar a lista para responder isso é o trabalho que a caixa
   * evita. Ela procura na descrição, no grupo e no valor exato.
   */
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return rows;
    const numero = Number(termo.replace(/\./g, "").replace(",", "."));
    return rows.filter(
      (r) =>
        r.descricao.toLowerCase().includes(termo) ||
        (r.grupo?.toLowerCase().includes(termo) ?? false) ||
        (!Number.isNaN(numero) && Math.abs(r.valor - numero) < 0.01),
    );
  }, [rows, busca]);

  // Agrupado como no documento: cada portador/seção vira um cabeçalho de bloco.
  const grupos = useMemo(() => {
    const lista: Array<{ grupo: string | null; itens: Draft[] }> = [];
    for (const row of visiveis) {
      const atual = lista[lista.length - 1];
      if (atual && atual.grupo === row.grupo) atual.itens.push(row);
      else lista.push({ grupo: row.grupo, itens: [row] });
    }
    return lista;
  }, [visiveis]);

  if (!extracao) {
    return (
      <div className="panel space-y-4 p-5">
        <div className="space-y-2">
          <Label>Anexar arquivo</Label>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_UPLOAD}
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null;
              setFile(chosen);
              if (chosen) setText("");
            }}
          />
          {file ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm">
              <FileUp className="size-4 shrink-0 text-primary" />
              <span className="truncate">{file.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <button
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label="Remover arquivo"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInput.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <FileUp className="size-4" /> PDF, OFX, CSV, Word, Excel ou TXT
            </button>
          )}
        </div>

        <div className="space-y-2">
          <Label>Ou cole o texto da fatura</Label>
          <Textarea
            rows={10}
            value={text}
            disabled={!!file}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "01/03  UBER TRIP           R$ 24,90\n02/03  MERCADO XPTO 2/5     R$ 189,00"
            }
            className="font-mono text-xs"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          A leitura é feita pelo próprio app, sem IA: as transações aparecem todas de uma vez e são
          conferidas contra os totais que o documento declara. A categorização com IA é uma etapa
          separada, depois da conferência — nada do arquivo é enviado nesta etapa.
        </p>

        <div className="flex justify-end">
          <Button onClick={start} disabled={loading || !canStart}>
            {loading ? "Lendo documento…" : "Ler documento"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/*
        Barra de ação da revisão, grudada no topo: numa fatura longa, ter de
        voltar ao começo da lista para lançar seria o mesmo que não ter botão.
      */}
      <div className="panel sticky top-16 z-10 flex flex-wrap items-center gap-2 p-3 backdrop-blur-xl lg:top-20">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {selected.length} de {rows.length}
          </span>{" "}
          selecionada{rows.length === 1 ? "" : "s"} para lançar
          {semCategoriaSelecionadas > 0 && (
            <span className="text-negative"> · {semCategoriaSelecionadas} sem categoria</span>
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={categorizar}
          disabled={categorizando || loading || config?.enabled === false}
          title={
            config?.enabled === false
              ? "Configure PROVEDOR_IA, MODELO_IA e OPENAI_API_KEY no servidor para ativar."
              : "Envia só as descrições numeradas e as categorias disponíveis; o arquivo nunca sai do servidor."
          }
        >
          <Sparkles className="size-4" />
          {categorizando ? "Categorizando…" : "Categorizar com IA"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmandoLimpeza(true)}
          disabled={upsert.isPending || loading}
        >
          <Trash2 className="size-4" /> Limpar
        </Button>
        <Button onClick={commit} disabled={upsert.isPending || loading}>
          Lançar selecionadas
        </Button>
      </div>

      {/*
        A leitura guardada é do perfil em que ela foi feita; lançar no perfil de
        agora mandaria os valores para o lugar errado sem nenhum aviso.
      */}
      {perfilDoRascunho && profileId && perfilDoRascunho !== profileId && (
        <p className="flex items-start gap-2 rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-negative" />
          Esta leitura foi feita em outro perfil. Lançar agora grava tudo no perfil selecionado no
          topo — volte ao perfil de origem ou limpe a leitura antes de lançar.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {ORIGEM_LABEL[extracao.origem]}
        {extracao.estatisticas.paginas > 1 && ` · ${extracao.estatisticas.paginas} páginas`} ·{" "}
        {extracao.estatisticas.linhas} linhas lidas · {rows.length} transações
        {extracao.periodo.inicio &&
          extracao.periodo.fim &&
          ` · período ${formatDateBR(extracao.periodo.inicio)} a ${formatDateBR(extracao.periodo.fim)}`}
      </p>

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold">Resumo da extração</p>
          <p className="text-[11px] text-muted-foreground">
            {selected.length} de {rows.length} selecionada{rows.length === 1 ? "" : "s"} para lançar
          </p>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-card p-2">
            <p className="label-caps text-[10px]">Entradas</p>
            <p className="font-mono text-sm font-bold text-positive">{brl(totals.income)}</p>
          </div>
          <div className="rounded-lg bg-card p-2">
            <p className="label-caps text-[10px]">Saídas</p>
            <p className="font-mono text-sm font-bold text-negative">{brl(totals.expense)}</p>
          </div>
          <div className="rounded-lg bg-card p-2">
            <p className="label-caps text-[10px]">Resultado</p>
            <p className="font-mono text-sm font-bold">{brl(totals.income - totals.expense)}</p>
          </div>
        </div>
      </div>

      {/* Conferência contra os checksums do próprio documento. */}
      {extracao.conferencia.disponivel ? (
        <div
          className={`rounded-xl border p-3 text-xs ${
            extracao.conferencia.fechouTudo
              ? "border-positive/40 bg-positive/5"
              : "border-negative/40 bg-negative/5"
          }`}
        >
          <button
            onClick={() => setShowTotais((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            {extracao.conferencia.fechouTudo ? (
              <CheckCircle2 className="size-4 shrink-0 text-positive" />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-negative" />
            )}
            <span className="flex-1">
              {extracao.conferencia.fechouTudo
                ? conferiveis.length === 1
                  ? "Conferência bateu: o total declarado no documento confere com as transações extraídas."
                  : `Conferência bateu: os ${conferiveis.length} totais declarados no documento conferem com as transações extraídas.`
                : `${totaisAbertos.length} de ${conferiveis.length} totais declarados no documento não fecharam. Confira as linhas destacadas antes de lançar.`}
            </span>
            {showTotais ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
          </button>
          {showTotais && (
            <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
              {conferiveis.map((total) => (
                <li key={total.linhaId} className="flex items-center gap-2">
                  {total.fechou ? (
                    <CheckCircle2 className="size-3 shrink-0 text-positive" />
                  ) : (
                    <AlertTriangle className="size-3 shrink-0 text-negative" />
                  )}
                  <span className="flex-1 truncate">{total.rotulo}</span>
                  <span className="font-mono">{brl(total.valor)}</span>
                  {!total.fechou && (
                    <span className="font-mono text-negative">
                      (faltam {brl(Math.abs(total.diferenca))})
                    </span>
                  )}
                </li>
              ))}
              {informativos > 0 && (
                <li className="pt-1 text-muted-foreground">
                  {informativos === 1
                    ? "1 outro valor declarado (limite, taxa, mínimo ou projeção) fica fora da conferência."
                    : `${informativos} outros valores declarados (limites, taxas, mínimos e projeções) ficam fora da conferência.`}
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
          O documento não declara totais, então a conferência de soma não se aplica. Confira as
          transações uma a uma antes de lançar.
        </p>
      )}

      {extracao.conferencia.alertas.map((alerta, i) => (
        <p
          key={i}
          className="flex items-center gap-2 rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs"
        >
          <AlertTriangle className="size-4 shrink-0 text-negative" />
          {alerta.mensagem}
        </p>
      ))}

      {extracao.naoInterpretadas.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <button
            onClick={() => setShowNaoInterpretadas((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="flex-1">
              {extracao.naoInterpretadas.length === 1
                ? "1 linha do documento não foi interpretada."
                : `${extracao.naoInterpretadas.length} linhas do documento não foram interpretadas.`}{" "}
              Nenhuma delas tem data e valor de transação.
            </span>
            {showNaoInterpretadas ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
          </button>
          {showNaoInterpretadas && (
            <ul className="mt-2 space-y-0.5 border-t border-border/60 pt-2 font-mono text-[11px]">
              {extracao.naoInterpretadas.map((linha) => (
                <li key={linha.linhaId} className="truncate">
                  {linha.texto}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-xs">
        <Label className="text-xs">Vencimento</Label>
        <DateField
          type="date"
          className="h-8 w-40 text-xs"
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
          aria-label="Data de vencimento do documento"
        />
        <span className="text-muted-foreground">
          aplicado a todas as transações ao lançar; sem ele, vale a data de cada linha.
        </span>
      </div>

      {/* Busca nos lançamentos detectados. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nos lançamentos detectados (descrição ou valor exato)…"
            className="pl-9"
            aria-label="Buscar nos lançamentos detectados"
          />
        </div>
        {busca && (
          <p className="text-xs text-muted-foreground">
            {visiveis.length} de {rows.length} · a busca só filtra a exibição, a seleção continua
            valendo
            <button
              onClick={() => setBusca("")}
              className="ml-2 font-medium text-foreground underline underline-offset-2"
            >
              limpar busca
            </button>
          </p>
        )}
      </div>

      <div className="grid grid-cols-12 gap-2 px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="col-span-1" />
        <span className="col-span-4">Descrição</span>
        <span className="col-span-2">Data</span>
        <span className="col-span-3">Categoria</span>
        <span className="col-span-2 text-right">Valor</span>
      </div>

      {visiveis.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum lançamento detectado corresponde a “{busca}”.
        </p>
      )}

      {grupos.map(({ grupo, itens }, gi) => (
        <div key={gi} className="space-y-2">
          {grupo && (
            <p className="label-caps px-2 pt-1 text-[10px] text-muted-foreground">{grupo}</p>
          )}
          {itens.map((r) => (
            <div
              key={r.linhaId}
              className={`grid grid-cols-12 items-center gap-2 rounded-xl border p-2 ${
                r.avisos.length > 0 ? "border-negative/50 bg-negative/5" : "border-border"
              }`}
            >
              <Checkbox
                checked={r.include}
                onCheckedChange={(checked) => patch(r.linhaId, { include: checked === true })}
                className="col-span-1"
                aria-label="Incluir transação"
              />
              <div className="col-span-4 space-y-1">
                <Input
                  className="h-8 text-xs"
                  value={r.descricao}
                  onChange={(e) => patch(r.linhaId, { descricao: e.target.value })}
                />
                <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  {r.parcela && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                      {r.parcela.numero}/{r.parcela.total}
                    </span>
                  )}
                  {r.estorno && (
                    <span className="flex items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-positive">
                      <Undo2 className="size-3" /> estorno
                    </span>
                  )}
                  {r.dataRaw && r.data !== r.dataIso && (
                    <span title="Data alterada; no documento está assim">
                      no documento: {r.dataRaw}
                    </span>
                  )}
                  {r.ia && r.category_id !== "" && (
                    <span
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
                        r.ia.confianca < 0.8 ? "bg-negative/10 text-negative" : "bg-secondary"
                      }`}
                      title={
                        r.ia.origem === "cache"
                          ? "Categoria lembrada de importações anteriores"
                          : `Categoria sugerida pela IA (confiança ${Math.round(r.ia.confianca * 100)}%)`
                      }
                    >
                      <Sparkles className="size-3" />
                      {r.ia.origem === "cache" ? "memória" : `${Math.round(r.ia.confianca * 100)}%`}
                    </span>
                  )}
                  {r.avisos.includes("orfao") && (
                    <span
                      className="flex items-center gap-1 text-negative"
                      title="Esta transação não soma em nenhum total declarado que fechou. Confira o documento."
                    >
                      <AlertTriangle className="size-3" /> fora dos totais
                    </span>
                  )}
                  {r.avisos.includes("sanidade") && (
                    <span
                      className="flex items-center gap-1 text-negative"
                      title="Um validador apontou esta linha (data fora do período ou valor fora do esperado)."
                    >
                      <AlertTriangle className="size-3" /> conferir
                    </span>
                  )}
                </span>
              </div>
              <DateField
                type="date"
                className="col-span-2 h-8 text-xs"
                value={r.data}
                onChange={(e) => patch(r.linhaId, { data: e.target.value })}
                aria-label="Data da transação"
              />
              <select
                className={`col-span-3 h-8 rounded-md border bg-card px-2 text-xs ${
                  r.include && !r.category_id ? "border-negative/60" : "border-input"
                }`}
                value={r.category_id}
                onChange={(e) => patch(r.linhaId, { category_id: e.target.value, ia: null })}
                aria-label="Categoria da transação"
              >
                <option value="">Escolha…</option>
                {categories
                  .filter((c) => c.kind === r.kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <span
                className={`col-span-2 text-right font-mono text-xs font-semibold ${
                  r.kind === "income" ? "text-positive" : "text-negative"
                }`}
              >
                {r.kind === "income" ? "+" : "−"}
                {brl(r.valor)}
              </span>
            </div>
          ))}
        </div>
      ))}

      {comAviso > 0 && (
        <p className="px-2 text-[11px] text-muted-foreground">
          {comAviso === 1
            ? "1 transação destacada merece conferência contra o documento."
            : `${comAviso} transações destacadas merecem conferência contra o documento.`}
        </p>
      )}

      {/*
        Limpar é o único caminho que joga a leitura fora — trocar de aba, voltar
        para as transações ou recarregar não mexem nela —, então ele confirma.
      */}
      <AlertDialog open={confirmandoLimpeza} onOpenChange={setConfirmandoLimpeza}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar os registros pendentes?</AlertDialogTitle>
            <AlertDialogDescription>
              As {rows.length} transações lidas deste documento saem da tela, junto das categorias
              já escolhidas. O que já foi lançado continua nas suas transações — só a revisão em
              aberto é descartada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmandoLimpeza(false);
                limpar();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
