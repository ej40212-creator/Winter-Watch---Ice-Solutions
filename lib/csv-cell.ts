/** Prefix spreadsheet formula triggers so a store id or address cannot execute in Excel. */
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}
