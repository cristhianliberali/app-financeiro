import { useState } from "react";
import { ArrowRight, CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { useAppState } from "@/lib/app-state";
import {
  monthKeyOf,
  monthRange,
  monthTitle,
  shiftMonthKey,
  toISODate,
  wholeMonthOf,
} from "@/lib/format";
import { DateField } from "@/components/ui/date-field";

/**
 * Barra de período do módulo Finanças.
 *
 * Ela morava espremida no cabeçalho, ao lado dos seletores de conta e perfil, e
 * o recorte — que é o que muda tudo o que a tela mostra — ficava do tamanho de
 * um detalhe. Aqui ela ocupa a largura toda, logo abaixo do cabeçalho, e o mês
 * vira o centro: as setas andam de mês em mês, que é o passo em que se pensa
 * dinheiro, e o nome do mês diz onde se está sem precisar ler duas datas.
 *
 * As setas só fazem sentido quando o recorte é um mês fechado. Num intervalo
 * qualquer ("7 dias", ou datas digitadas na mão) elas somem e a barra mostra o
 * próprio intervalo — andar "um mês" a partir de um pedaço de mês não teria um
 * resultado óbvio.
 *
 * ## Duas formas, um controle
 *
 * No desktop tudo cabe numa linha e tudo fica à vista. No celular não cabia:
 * mês, quatro atalhos, duas datas de 140px e o par Transação/Vencimento eram
 * cinco blocos numa faixa `flex-wrap`, que virava quatro fileiras
 * desalinhadas — a mais alta da tela, e logo abaixo de um cabeçalho que já
 * tinha três.
 *
 * A saída não foi encolher: foi separar o que se usa todo dia do que se usa de
 * vez em quando. Todo dia se anda de mês em mês e se alterna entre transação e
 * vencimento — isso fica visível. Escolher "7 dias" ou digitar um intervalo é
 * exceção, e exceção mora atrás de um toque, não ocupando metade da tela em
 * troca de nada.
 */
export function PeriodBar() {
  const { dateBasis, setDateBasis, from, to, setRange } = useAppState();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const month = wholeMonthOf(from, to);
  const today = new Date();
  const thisMonth = monthKeyOf(toISODate(today));

  function goToMonth(key: string) {
    const range = monthRange(key);
    setRange(range.from, range.to);
  }

  const presets: Array<{ label: string; apply: () => void; active: boolean }> = [
    {
      label: "Hoje",
      apply: () => setRange(toISODate(today), toISODate(today)),
      active: from === toISODate(today) && to === toISODate(today),
    },
    {
      label: "7 dias",
      apply: () => {
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        setRange(toISODate(start), toISODate(today));
      },
      active: false,
    },
    { label: "Este mês", apply: () => goToMonth(thisMonth), active: month === thisMonth },
    {
      label: "Este ano",
      apply: () =>
        setRange(
          toISODate(new Date(today.getFullYear(), 0, 1)),
          toISODate(new Date(today.getFullYear(), 11, 31)),
        ),
      active:
        from === toISODate(new Date(today.getFullYear(), 0, 1)) &&
        to === toISODate(new Date(today.getFullYear(), 11, 31)),
    },
  ];

  /* Os atalhos de recorte: fileira no desktop, grade de dois no celular. */
  const presetButtons = presets.map((preset) => (
    <button
      key={preset.label}
      onClick={preset.apply}
      aria-pressed={preset.active}
      className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all lg:py-1.5 ${
        preset.active
          ? "bg-primary text-primary-foreground shadow-xs"
          : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground lg:bg-transparent"
      }`}
    >
      {preset.label}
    </button>
  ));

  /* O intervalo digitado à mão, com as duas pontas. */
  const rangeFields = (
    <div className="flex items-center gap-1 rounded-xl border border-border px-1.5 py-1">
      <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
      <DateField
        value={from}
        onChange={(e) => setRange(e.target.value, to)}
        aria-label="Início do período"
        className="h-9 w-full min-w-0 rounded-lg border-transparent bg-transparent text-xs shadow-none lg:h-8 lg:w-[8.75rem]"
      />
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
      <DateField
        value={to}
        onChange={(e) => setRange(from, e.target.value)}
        aria-label="Fim do período"
        className="h-9 w-full min-w-0 rounded-lg border-transparent bg-transparent text-xs shadow-none lg:h-8 lg:w-[8.75rem]"
      />
    </div>
  );

  /* Transação ou vencimento: a mesma escolha nas duas formas da barra. */
  const basisToggle = (
    <div className="flex rounded-lg bg-secondary p-0.5 text-[10px] font-bold uppercase tracking-wider">
      {(
        [
          ["transaction_date", "Transação"],
          ["due_date", "Vencimento"],
        ] as const
      ).map(([basis, label]) => (
        <button
          key={basis}
          onClick={() => setDateBasis(basis)}
          className={`flex-1 whitespace-nowrap rounded-[4px] px-2.5 py-2 transition-all lg:flex-none lg:py-1.5 ${
            dateBasis === basis
              ? "bg-card text-foreground shadow-xs ring-1 ring-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="panel p-2">
      {/*
        Linha do mês. No celular ela é a barra inteira: as setas nas pontas com
        alvo de 40px, o nome do mês esticando no meio. Andar de mês é o gesto
        mais repetido da tela e merece a largura toda.
      */}
      {/*
        Uma linha só no celular (`flex-nowrap`, que é o padrão): ali a linha tem
        três itens de tamanho conhecido e não pode quebrar. Do `lg` para cima a
        quebra volta — são seis blocos disputando a largura, e numa janela mais
        estreita é melhor a barra ganhar uma segunda linha do que espremer os
        rótulos até quebrarem no meio da palavra.
      */}
      <div className="flex items-center gap-1 lg:flex-wrap lg:gap-x-3 lg:gap-y-2">
        <button
          onClick={() => month && goToMonth(shiftMonthKey(month, -1))}
          disabled={!month}
          aria-label="Mês anterior"
          title="Mês anterior"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:pointer-events-none disabled:opacity-30 lg:size-9"
        >
          <ChevronLeft className="size-5 lg:size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-bold tracking-tight first-letter:uppercase lg:min-w-40 lg:flex-none lg:overflow-visible">
          {month ? monthTitle(month) : "Período personalizado"}
        </span>
        <button
          onClick={() => month && goToMonth(shiftMonthKey(month, 1))}
          disabled={!month}
          aria-label="Próximo mês"
          title="Próximo mês"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:pointer-events-none disabled:opacity-30 lg:size-9"
        >
          <ChevronRight className="size-5 lg:size-4" />
        </button>

        {/* Do `lg` para cima cabe tudo na mesma linha, como sempre coube. */}
        <div className="hidden h-6 w-px bg-border lg:block" />
        <div className="hidden gap-0.5 lg:flex">{presetButtons}</div>
        <div className="hidden lg:block">{rangeFields}</div>
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <span className="label-caps">Considerar</span>
          {basisToggle}
        </div>

        {/*
          O resto do recorte, atrás de um toque. O botão gira a seta em vez de
          trocar de rótulo: o estado aberto/fechado se lê sem ler.
        */}
        <button
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          aria-label="Mais opções de período"
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg border border-border transition-colors lg:hidden ${
            detailsOpen ? "bg-primary-soft text-primary" : "text-muted-foreground"
          }`}
        >
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${detailsOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Base da data: sempre à vista no celular — é escolha de leitura, não
          de navegação, e esconder muda o significado dos números sem aviso. */}
      <div className="mt-2 lg:hidden">{basisToggle}</div>

      {detailsOpen && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 lg:hidden">
          <div className="grid grid-cols-2 gap-1.5">{presetButtons}</div>
          {rangeFields}
        </div>
      )}
    </div>
  );
}
