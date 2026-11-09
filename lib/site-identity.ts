import { createHash } from "node:crypto";

export type ImportRow = {
  provisionalKey: string;
  excelRow: number | null;
  sourceSiteId: string;
  sourceSiteIdRaw: string;
  address: string;
  state: string;
  classification: string;
  region?: string;
};

/** Uppercase, collapse whitespace, strip punctuation. Used only inside the fingerprint. */
export function normalizeAddress(address: string): string {
  return address.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function contentFingerprint(sourceSiteId: string, state: string, address: string): string {
  return createHash("sha256").update(`v1|${sourceSiteId}|${state}|${normalizeAddress(address)}`).digest("hex");
}

/**
 * Preserve the source token exactly.
 * Numbers become their decimal form with no added zeros.
 * Digit strings, including leading zeros, are kept. Nothing is padded or stripped.
 */
export function canonicalSourceId(raw: unknown): { id: string; raw: string } {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (!Number.isInteger(raw)) throw new Error("Source id must be an integer or a digit string.");
    const text = String(raw);
    return { id: text, raw: text };
  }
  const text = String(raw ?? "");
  return { id: text, raw: text };
}

/** End-anchored checks only. A 5-digit street number is not treated as a ZIP. */
export function addressFlagReasons(address: string): string[] {
  const trimmed = address.trim();
  const reasons: string[] = [];
  if (!/\b\d{5}(?:-\d{4})?\s*$/.test(trimmed)) reasons.push("address_missing_zip");
  if (!/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/.test(trimmed)) reasons.push("address_incomplete_postal_form");
  return reasons;
}

export function rowsFromContract(records: unknown[]): ImportRow[] {
  return records.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Row ${index} is not an object.`);
    const row = item as Record<string, unknown>;
    const id = canonicalSourceId(row.id);
    const key = String(row.key ?? "");
    if (!key) throw new Error(`Row ${index} is missing a lineage key.`);
    const excel = /^sheet1-r(\d+)$/.exec(key);
    return {
      provisionalKey: key,
      excelRow: excel ? Number(excel[1]) : null,
      sourceSiteId: id.id,
      sourceSiteIdRaw: id.raw,
      address: String(row.address ?? ""),
      state: String(row.state ?? ""),
      classification: String(row.classification ?? ""),
      region: row.region == null ? undefined : String(row.region),
    };
  });
}

export function accountRows(rows: ImportRow[]) {
  const included = rows.filter((row) => row.state !== "DC");
  const byId = new Map<string, number>();
  let addressFlagRows = 0;
  let overlap = 0;
  for (const row of included) {
    const idKey = `${row.sourceSiteId}|${row.state}`;
    byId.set(idKey, (byId.get(idKey) ?? 0) + 1);
  }
  let duplicateRows = 0;
  let duplicateIdValues = 0;
  for (const count of byId.values()) {
    if (count > 1) {
      duplicateIdValues += 1;
      duplicateRows += count;
    }
  }
  for (const row of included) {
    const flagged = addressFlagReasons(row.address).length > 0;
    const repeated = (byId.get(`${row.sourceSiteId}|${row.state}`) ?? 0) > 1;
    if (flagged) addressFlagRows += 1;
    if (flagged && repeated) overlap += 1;
  }
  return {
    inputRows: rows.length,
    candidates: included.length,
    excludedDc: rows.length - included.length,
    duplicateIdValues,
    duplicateRows,
    addressFlagRows,
    overlap,
  };
}
