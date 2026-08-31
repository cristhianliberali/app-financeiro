/**
 * Gerador de PDF mínimo para os testes da camada de ingestão.
 *
 * Escrever o PDF à mão evita uma dependência de produção só para fixture, e
 * deixa o teste dizer exatamente onde cada texto está na página — que é o que
 * a camada 1 precisa provar que lê (agrupamento por tolerância vertical e bbox).
 */

export type PdfTextItem = {
  /** Canto inferior esquerdo do texto, em pontos, origem no canto inferior. */
  x: number;
  y: number;
  text: string;
  size?: number;
};

/** Escapa os caracteres que têm significado dentro de uma string literal PDF. */
function escapeText(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

function contentStream(items: PdfTextItem[]): string {
  return items
    .map(
      (item) =>
        `BT /F1 ${item.size ?? 10} Tf 1 0 0 1 ${item.x} ${item.y} Tm ` +
        `(${escapeText(item.text)}) Tj ET`,
    )
    .join("\n");
}

/**
 * Monta um PDF de uma ou mais páginas com os itens de texto informados.
 * Só o necessário: catálogo, páginas, uma fonte Type1 padrão e o conteúdo.
 */
export function makePdf(pages: PdfTextItem[][]): Uint8Array {
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);

  // 1 catálogo, 2 páginas, 3 fonte, depois cada página e seu conteúdo.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] ` +
    `/Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((items, index) => {
    const pageId = pageObjectIds[index]!;
    const contentId = pageId + 1;
    const stream = contentStream(items);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` + `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
