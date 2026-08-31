/**
 * Cache de merchants da camada 3.
 *
 * A chave é o descritor cru normalizado — `VIPI SUPERMERCADOS E`, e não um nome
 * "limpo": é o descritor que se repete idêntico de fatura em fatura, mês após
 * mês. O cache é global, e não por usuário: `MERCADOLIVRE*`, `APPLE.COM/BILL`,
 * `TIM*` e `DM *Spotify` valem para a base inteira.
 *
 * Com o tempo o custo de classificação tende a zero e passa a depender da
 * diversidade de estabelecimentos, não do volume de transações.
 */

export type RotuloMerchant = {
  categoria: string;
  confianca: number;
};

export type CacheMerchants = {
  buscar(chave: string): Promise<RotuloMerchant | null>;
  gravar(chave: string, rotulo: RotuloMerchant): Promise<void>;
};

/**
 * Normaliza o descritor sem descaracterizá-lo: maiúsculas, sem acento e com o
 * espaçamento colapsado. O `*` e o `.` continuam, porque fazem parte do que o
 * adquirente escreve e são o que distingue um descritor do outro.
 */
export function chaveMerchant(descritor: string): string {
  return descritor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cache de processo. Serve para desenvolvimento e para os testes; em produção
 * o mesmo contrato é atendido por uma tabela, e aí o cache passa a valer entre
 * réplicas e entre reinícios.
 */
export function cacheEmMemoria(inicial: Record<string, RotuloMerchant> = {}): CacheMerchants {
  const rotulos = new Map<string, RotuloMerchant>(
    Object.entries(inicial).map(([chave, rotulo]) => [chaveMerchant(chave), rotulo]),
  );

  return {
    async buscar(chave) {
      return rotulos.get(chaveMerchant(chave)) ?? null;
    },
    async gravar(chave, rotulo) {
      rotulos.set(chaveMerchant(chave), rotulo);
    },
  };
}
