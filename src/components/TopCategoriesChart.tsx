"use client";

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

type Row = { name: string; color: string; minor: string };

export function TopCategoriesChart({ rows }: { rows: Row[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart(canvas.current, {
      type: "bar",
      data: { labels: rows.map((row) => row.name), datasets: [{ data: rows.map((row) => Number(row.minor) / 100), backgroundColor: rows.map((row) => row.color), borderRadius: 3, barThickness: 14 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(context.raw)) } } },
        scales: { x: { beginAtZero: true, grid: { color: "#edf1f1" }, ticks: { color: "#6d7f7f", callback: (value) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value)) } }, y: { grid: { display: false }, ticks: { color: "#6d7f7f" } } },
      },
    });
    return () => chart.destroy();
  }, [rows]);

  return <div className="chart-box top-categories-chart"><canvas ref={canvas} aria-label="Top expense categories" role="img" /></div>;
}