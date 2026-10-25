"use client";

import { Download } from "lucide-react";

type Row = { name: string; plannedMinor: string; actualMinor: string };

export function ReportExport({ month, rows }: { month: string; rows: Row[] }) {
  function exportCsv() {
    const content = [
      ["Month", "Category", "Planned (INR)", "Actual (INR)"],
      ...rows.map((row) => [month, row.name, (Number(row.plannedMinor) / 100).toFixed(2), (Number(row.actualMinor) / 100).toFixed(2)]),
    ].map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `selavu-report-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <button type="button" className="secondary" onClick={exportCsv}><Download size={16} aria-hidden="true" />Export CSV</button>;
}