/**
 * Compras parceladas: nome, datas e divisão do valor.
 *
 * Vale para os dois caminhos — o lançamento manual e a importação por IA —,
 * então mora em `lib` e não tem nada de navegador nem de servidor.
 *
 * O padrão do nome é `DESCRIÇÃO k/n`. É ele que deixa a lista de transações
 * legível ("C E A 2/3") e, junto com o grupo, é o que liga as parcelas de uma
 * mesma compra.
 */

/** Teto de parcelas aceito nos formulários. */
export const MAX_INSTALLMENTS = 48;

/**
 * Tira da descrição a marca de parcela que já veio junto — "03/10", "(3/10)",
 * "3 de 10". A fatura escreve isso de um jeito, o app escreve de outro, e sem
 * limpar o nome viraria "C E A 01/03 1/3".
 *
 * Sabendo o número e o total, a marca é removida onde quer que esteja: a fatura
 * costuma pôr a cidade depois dela ("LOJA X 01/03 CHAPECO"). Sem saber, só a
 * marca no fim sai — no meio do nome, um "10/12" solto pode ser qualquer coisa,
 * e apagar por engano é pior que deixar.
 */
export function stripInstallmentSuffix(
  description: string,
  no?: number | null,
  total?: number | null,
): string {
  let out = description.trim();

  if (typeof no === "number" && typeof total === "number" && total > 1) {
    const marca = new RegExp(
      `[([]?\\s*0*${no}\\s*(?:\\/|\\s+de\\s+)\\s*0*${total}\\s*[)\\]]?`,
      "gi",
    );
    out = out.replace(marca, " ");
  }

  return out
    .replace(/[\s·-]*[([]?\s*\d{1,2}\s*(?:\/|\s+de\s+)\s*\d{1,2}\s*[)\]]?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** `DESCRIÇÃO k/n`, sem duplicar a marca que já estivesse no nome. */
export function installmentLabel(description: string, no: number, total: number): string {
  const base = stripInstallmentSuffix(description) || description.trim() || "Lançamento";
  return `${base} ${no}/${total}`;
}

/** A linha é de uma compra parcelada com número e total coerentes? */
export function hasInstallments(no: number | null, total: number | null): boolean {
  return (
    typeof no === "number" &&
    typeof total === "number" &&
    Number.isInteger(no) &&
    Number.isInteger(total) &&
    total > 1 &&
    total <= 99 &&
    no >= 1 &&
    no <= total
  );
}

/**
 * Avança meses numa data ISO preservando o dia. Dia 31 em mês curto cai no
 * último dia do mês (31/01 + 1 mês = 28/02), que é como cartão e boleto tratam
 * o vencimento — `setMonth` sozinho viraria 03/03.
 */
export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const safeDay = String(Math.min(day, lastDay)).padStart(2, "0");
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${safeDay}`;
}

/**
 * Divide o valor total entre as parcelas sem perder centavo: o resto vai para
 * as primeiras, como fazem as lojas. 100 em 3 vira 33,34 + 33,33 + 33,33.
 */
export function splitAmount(total: number, count: number): number[] {
  const parts = Math.max(1, Math.trunc(count));
  const cents = Math.round(Math.abs(total) * 100);
  const base = Math.floor(cents / parts);
  const rest = cents - base * parts;
  return Array.from({ length: parts }, (_, index) => (base + (index < rest ? 1 : 0)) / 100);
}

export type InstallmentPreview = {
  no: number;
  total: number;
  amount: number;
  /** Vencimento da parcela, em ISO. */
  due_date: string;
};

/**
 * As parcelas de uma compra: valor dividido e vencimento avançando um mês por
 * parcela. É o que o formulário mostra antes de gravar e o que ele grava.
 */
export function buildInstallments(input: {
  total: number;
  count: number;
  firstDueDate: string;
}): InstallmentPreview[] {
  const amounts = splitAmount(input.total, input.count);
  return amounts.map((amount, index) => ({
    no: index + 1,
    total: amounts.length,
    amount,
    due_date: addMonths(input.firstDueDate, index),
  }));
}
