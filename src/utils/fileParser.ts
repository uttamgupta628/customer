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
  originalName: string,
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
  const text = buffer.toString("utf-8").replace(/^\uFEFF/, ""); // strip BOM

  // Auto-detect delimiter
  const firstLine = text.split("\n")[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ";" : ",";

  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    delimiter, // ← use detected delimiter
  }) as RawRow[];

  return records.map((record) => {
    const normalized: RawRow = {};
    Object.keys(record).forEach((key) => {
      // Strip BOM from first key (extra safety)
      const cleanKey = key.replace(/^\uFEFF/, "");
      const normalizedKey = cleanKey
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      normalized[normalizedKey] = record[key];
    });
    return normalized;
  });
}

function parseExcel(buffer: Buffer): RawRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(firstSheet, {
    defval: "", // empty cells default to empty string
    raw: false, // all values as strings
  });

  // Normalize keys
  return rows.map((record) => {
    const normalized: RawRow = {};
    Object.keys(record).forEach((key) => {
      const normalizedKey = key
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      normalized[normalizedKey] = record[key];
    });
    return normalized;
  });
}
