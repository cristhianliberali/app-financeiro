/**
 * Converte o arquivo enviado em texto puro.
 *
 * A IA só recebe texto — nada de PDF ou planilha é mandado adiante. O arquivo
 * chega em base64, é lido em memória e descartado: nada vai para disco nem
 * para storage externo.
 */

/** Teto do arquivo depois de decodificado. Base64 chega ~33% maior. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export type UploadInput = {
  name: string;
  /** Conteúdo do arquivo em base64, sem o prefixo `data:`. */
  base64: string;
};

export type ExtractedDocument = {
  text: string;
  /** Formato reconhecido, usado só para mensagens ao usuário. */
  kind: "pdf" | "docx" | "planilha" | "csv" | "texto";
};

const EXTENSIONS: Record<string, ExtractedDocument["kind"]> = {
  pdf: "pdf",
  docx: "docx",
  doc: "docx",
  xlsx: "planilha",
  xlsm: "planilha",
  xls: "planilha",
  csv: "csv",
  txt: "texto",
  text: "texto",
  ofx: "texto",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS);

function kindOf(name: string): ExtractedDocument["kind"] {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = EXTENSIONS[extension];
  if (!kind) {
    throw new Error(
      `Formato não suportado: .${extension || "?"}. Aceitos: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
    );
  }
  return kind;
}

/** Junta as linhas removendo espaços redundantes e linhas vazias repetidas. */
function tidy(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      // PDFs vêm cheios de espaço não separável (\u00A0); vira espaço comum aqui.
      .map((line) => line.replace(/[ \t\u00A0]+/g, " ").trim())
      .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
      .join("\n")
      .trim()
  );
}

async function fromPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // O pdf.js recusa `Buffer` explicitamente, mesmo ele estendendo Uint8Array:
  // a cópia abaixo entrega um Uint8Array puro, que é o que ele aceita.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function fromDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

/**
 * Planilha vira texto delimitado por " | ", uma linha por linha da planilha.
 * O modelo lê isso bem, e mantém a correspondência entre colunas e valores.
 */
async function fromSpreadsheet(bytes: Uint8Array): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);

  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    if (workbook.worksheets.length > 1) lines.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const value = cell.value;
        if (value === null || value === undefined) cells.push("");
        else if (value instanceof Date) cells.push(value.toISOString().slice(0, 10));
        else if (typeof value === "object" && "text" in value) cells.push(String(value.text));
        else if (typeof value === "object" && "result" in value) cells.push(String(value.result));
        else cells.push(String(value));
      });
      const line = cells.join(" | ").trim();
      if (line.replace(/\|/g, "").trim()) lines.push(line);
    });
  });
  return lines.join("\n");
}

export async function extractText(file: UploadInput): Promise<ExtractedDocument> {
  const kind = kindOf(file.name);
  const bytes = Buffer.from(file.base64, "base64");

  if (bytes.byteLength === 0) throw new Error("O arquivo enviado está vazio.");
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `Arquivo de ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB excede o limite de ` +
        `${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }

  let raw: string;
  if (kind === "pdf") raw = await fromPdf(bytes);
  else if (kind === "docx") raw = await fromDocx(bytes);
  else if (kind === "planilha") raw = await fromSpreadsheet(bytes);
  else raw = bytes.toString("utf8");

  const text = tidy(raw);
  if (text.length < 10) {
    throw new Error(
      kind === "pdf"
        ? "Não foi possível ler texto deste PDF. Ele pode ser digitalizado (imagem); cole o texto manualmente."
        : "O arquivo não tem texto legível.",
    );
  }
  return { text, kind };
}
