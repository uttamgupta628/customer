import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

export interface RawRow {
  [key: string]: string;
}

/**
 * Parse a CSV or Excel buffer into an array of raw row objects.
 * Keys are taken from the first header row.
 */
export function parseFileBuffer(
  buffer: Buffer,
  mimetype: string,
  originalName: string
): RawRow[] {
  const isExcel =
    mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel" ||
    originalName.endsWith(".xlsx") ||
    originalName.endsWith(".xls");

  if (isExcel) {
    return parseExcel(buffer);
  }

  return parseCsv(buffer);
}

function parseCsv(buffer: Buffer): RawRow[] {
  const records = parse(buffer, {
    columns: true,         // use first row as header keys
    skip_empty_lines: true,
    trim: true,
    bom: true,             // handle BOM if present
  }) as RawRow[];

  return records;
}

function parseExcel(buffer: Buffer): RawRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(firstSheet, {
    defval: "",           // empty cells default to empty string
    raw: false,           // all values as strings
  });
  return rows;
}
