"use client";

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

type ReportData = {
  categories: { name: string; color: string; actualMinor: string; plannedMinor: string }[];
  daily: { day: number; cumulativeMinor: string }[];
  trend: { month: string; totalMinor: string }[];
  plannedMinor: string;
};

const amount = (minor: string) => Number(minor) / 100;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function ReportCharts({ report }: { report: ReportData }) {
  const variance = useRef<HTMLCanvasElement>(null);
  const mix = useRef<HTMLCanvasElement>(null);
  const daily = useRef<HTMLCanvasElement>(null);
  const trend = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const charts: Chart[] = [];
    const categories = report.categories;
    const tooltip = { callbacks: { label: (context: { raw: unknown; dataset: { label?: string } }) => `${context.dataset.label ?? ""} ${money(Number(context.raw))}` } };
    const axis = {
      x: { grid: { display: false }, ticks: { color: "#6d7f7f", font: { size: 10 } } },
      y: { beginAtZero: true, grid: { color: "#edf1f1" }, ticks: { color: "#6d7f7f", font: { size: 10 }, callback: (value: string | number) => money(Number(value)) } },
    };

    if (variance.current) charts.push(new Chart(variance.current, {
      type: "bar",
      data: { labels: categories.map((category) => category.name), datasets: [
        { label: "Planned", data: categories.map((category) => amount(category.plannedMinor)), backgroundColor: "#cce3dd", borderRadius: 3 },
        { label: "Actual", data: categories.map((category) => amount(category.actualMinor)), backgroundColor: "#087f77", borderRadius: 3 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip }, scales: axis },
    }));
    if (mix.current) charts.push(new Chart(mix.current, {
      type: "doughnut",
      data: { labels: categories.map((category) => category.name), datasets: [{ data: categories.map((category) => amount(category.actualMinor)), backgroundColor: categories.map((category) => category.color), borderWidth: 3, borderColor: "#fff" }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "66%", plugins: { legend: { position: "bottom" }, tooltip } },
    }));
    if (daily.current) charts.push(new Chart(daily.current, {
      type: "line",
      data: { labels: report.daily.map((point) => point.day), datasets: [
        { label: "Expenses", data: report.daily.map((point) => amount(point.cumulativeMinor)), borderColor: "#087f77", backgroundColor: "#087f7718", fill: true, pointRadius: 0, tension: 0.2 },
        { label: "Monthly plan", data: report.daily.map(() => amount(report.plannedMinor)), borderColor: "#e8ba48", borderDash: [5, 5], pointRadius: 0 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip }, scales: axis },
    }));
    if (trend.current) charts.push(new Chart(trend.current, {
      type: "bar",
      data: { labels: report.trend.map((point) => new Date(`${point.month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })), datasets: [{ label: "Expenses", data: report.trend.map((point) => amount(point.totalMinor)), backgroundColor: "#c9e2dc", borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: axis },
    }));

    return () => charts.forEach((chart) => chart.destroy());
  }, [report]);

  return (
    <div className="report-grid">
      <section className="panel"><div className="panel-head"><div><h2>Plan meets reality</h2><p>Regular spending by category</p></div></div><div className="chart-box"><canvas ref={variance} aria-label="Planned and actual spending by category" role="img" /></div></section>
      <section className="panel"><div className="panel-head"><div><h2>Spending mix</h2><p>Share of selected-month expenses</p></div></div><div className="chart-box"><canvas ref={mix} aria-label="Expense share by category" role="img" /></div></section>
      <section className="panel"><div className="panel-head"><div><h2>Day by day</h2><p>Cumulative expenses and monthly plan</p></div></div><div className="chart-box"><canvas ref={daily} aria-label="Daily cumulative expenses compared with the monthly plan" role="img" /></div></section>
      <section className="panel"><div className="panel-head"><div><h2>Month over month</h2><p>Selected month and five preceding months</p></div></div><div className="chart-box"><canvas ref={trend} aria-label="Six month expense trend" role="img" /></div></section>
    </div>
  );
}