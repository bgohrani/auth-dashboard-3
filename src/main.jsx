import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Papa from "papaparse";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { GOOGLE_SHEET_CSV_URL, AI_API_URL } from "./dataSource";
import "./styles.css";

const SECTIONS = [
  ["overview", "Overview"],
  ["performance", "Authorization Performance"],
  ["decline", "Decline Analysis"],
  ["risk", "Fraud & Chargebacks"],
];

const FILTER_GROUPS = [
  { key: "time", label: "Time", icon: "◷", fields: [["year_month", "Year / Month"]] },
  { key: "issuer", label: "Issuer", icon: "🏦", fields: [["issuer_name", "Issuer Name"], ["issuer_country", "Issuer Country"]] },
  { key: "merchant", label: "Merchant", icon: "🏪", fields: [["merchant_name", "Merchant Name"], ["mcc", "MCC"]] },
  { key: "product", label: "Product", icon: "▣", fields: [["prod type", "Product"]] },
  { key: "payment", label: "Payment", icon: "↔", fields: [["acquirer_name", "Acquirer"], ["channel", "Channel"], ["wallet", "Wallet"]] },
  { key: "authentication", label: "Authentication", icon: "◇", fields: [["3DS", "3DS"], ["tokenization", "Tokenization"], ["entry mode code", "Entry Mode"]] },
  { key: "ticket", label: "Transaction", icon: "▤", fields: [["ticket size bands", "Ticket Band"]] },
];

const FILTER_FIELDS = FILTER_GROUPS.flatMap((group) => group.fields);

const MODEL_OPTIONS = [
  { provider: "gemini", model: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  { provider: "groq", model: "openai/gpt-oss-20b", label: "GPT-OSS 20B · Groq" },
  { provider: "openrouter", model: "openrouter/free", label: "OpenRouter Free" },
];

const EMPTY_FILTERS = Object.fromEntries(FILTER_FIELDS.map(([key]) => [key, []]));

const n = (v) => {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};

const pct = (a, b) => (b ? (a / b) * 100 : 0);
const money = (v) =>
  new Intl.NumberFormat("en-US", {
    notation: Math.abs(v) >= 1e9 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(v);

const number = (v) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

const rate = (v) => `${v.toFixed(1)}%`;
const bps = (v) => `${Number(v).toFixed(2)} BPS`;

const normalizeRow = (r) => {
  const row = {};
  Object.entries(r).forEach(([k, v]) => {
    row[String(k).trim()] = typeof v === "string" ? v.trim() : v;
  });
  return row;
};

function aggregate(rows) {
  let approved = 0;
  let declined = 0;
  let approvedAmt = 0;
  let declinedAmt = 0;
  let fraud = 0;
  let fraudAmt = 0;
  let cb = 0;
  let cbAmt = 0;

  rows.forEach((r) => {
    approved += n(r["approved count"]);
    declined += n(r["decline count"]);
    approvedAmt += n(r["approved amt"]);
    declinedAmt += n(r["decline amount"]);
    fraud += n(r["fraud count"]);
    fraudAmt += n(r["fraud amt"]);
    cb += n(r["chargeback count"]);
    cbAmt += n(r["chargeback total"]);
  });

  const total = approved + declined;
  return {
    approved,
    declined,
    total,
    approvedAmt,
    declinedAmt,
    fraud,
    fraudAmt,
    cb,
    cbAmt,
    approvalRate: pct(approved, total),
    declineRate: pct(declined, total),
    fraudRate: pct(fraud, approved),
    cbRate: pct(cb, approved),
    avgApprovedTicket: approved ? approvedAmt / approved : 0,
  };
}

function groupBy(rows, key, valueFn = (r) => n(r["approved count"]) + n(r["decline count"])) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r[key] || "Unknown";
    map.set(k, (map.get(k) || 0) + valueFn(r));
  });
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function groupRates(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r[key] || "Unknown";
    const current = map.get(k) || { approved: 0, declined: 0, fraud: 0 };
    current.approved += n(r["approved count"]);
    current.declined += n(r["decline count"]);
    current.fraud += n(r["fraud count"]);
    map.set(k, current);
  });
  return [...map.entries()]
    .map(([name, x]) => ({
      name,
      approval: pct(x.approved, x.approved + x.declined),
      fraud: pct(x.fraud, x.approved),
    }))
    .sort((a, b) => b.approval - a.approval);
}

function monthly(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r.year_month || "Unknown";
    const x = map.get(k) || { approved: 0, declined: 0, approvedAmt: 0, declineAmt: 0 };
    x.approved += n(r["approved count"]);
    x.declined += n(r["decline count"]);
    x.approvedAmt += n(r["approved amt"]);
    x.declineAmt += n(r["decline amount"]);
    map.set(k, x);
  });
  return [...map.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([name, x]) => ({
      name,
      approved: x.approved,
      declined: x.declined,
      approvalRate: pct(x.approved, x.approved + x.declined),
      approvedAmt: x.approvedAmt,
      declineAmt: x.declineAmt,
    }));
}
function acquirerMonthly(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const acquirer = String(r.acquirer_name ?? "").trim() || "NA";
    const month = String(r.year_month ?? "").trim() || "NA";

    const key = `${acquirer}|||${month}`;

    if (!map.has(key)) {
      map.set(key, {
        acquirer,
        month,
        approved: 0,
        declined: 0,
      });
    }

    const x = map.get(key);

    x.approved += n(r["approved count"]);
    x.declined += n(r["decline count"]);
  });

  const acquirers = [
    ...new Set([...map.values()].map((x) => x.acquirer)),
  ].sort();

  const months = [
    ...new Set([...map.values()].map((x) => x.month)),
  ].sort();

  const data = months.map((month) => {
    const row = {
      month,
    };

    acquirers.forEach((acquirer) => {
      const x = map.get(`${acquirer}|||${month}`);

      row[acquirer] = x
        ? pct(x.approved, x.approved + x.declined)
        : null;
    });

    return row;
  });

  return {
    data,
    acquirers,
  };
}


function categoryMetrics(rows, key) {
  const map = new Map();

  rows.forEach((r) => {
    const value = String(r[key] ?? "").trim();

    // Exclude blank / NA values
    if (!value || value.toUpperCase() === "NA") return;

    const approved = n(r["approved count"]);
    const declined = n(r["decline count"]);
    const approvedAmt = n(r["approved amt"]);
    const declineAmt = n(r["decline amount"]);

    if (!map.has(value)) {
      map.set(value, {
        name: value,
        value: 0,
        approved: 0,
        approvedAmt: 0,
        totalAmt: 0,
      });
    }

    const x = map.get(value);

    x.value += approved + declined;
    x.approved += approved;
    x.approvedAmt += approvedAmt;
    x.totalAmt += approvedAmt + declineAmt;
  });

  return [...map.values()].map((x) => ({
    ...x,
    approvalRateCount: pct(x.approved, x.value),
    approvalRateAmount: pct(x.approvedAmt, x.totalAmt),
  }));
}

function ticketDeclineMix(rows) {
  const byTicket = new Map();

  rows.forEach((r) => {
    const ticket = String(r["ticket size bands"] ?? "").trim() || "NA";
    const reason = String(r.response_description ?? "").trim() || "NA";
    const count = n(r["decline count"]);

    if (!byTicket.has(ticket)) {
      byTicket.set(ticket, new Map());
    }

    const reasonMap = byTicket.get(ticket);
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + count);
  });

  return [...byTicket.entries()].map(([ticket, reasonMap]) => {
    const sorted = [...reasonMap.entries()]
      .sort((a, b) => b[1] - a[1]);

    const top4 = sorted.slice(0, 4);
    const others = sorted.slice(4).reduce((sum, [, value]) => sum + value, 0);

    const total = sorted.reduce((sum, [, value]) => sum + value, 0);

    const row = {
      ticket,
    };

    top4.forEach(([reason, value], index) => {
      row[`reason_${index}`] = total ? (value / total) * 100 : 0;
      row[`reason_${index}_name`] = reason;
    });

    row.reason_others = total ? (others / total) * 100 : 0;
    row.reason_others_name = "Others";

    return row;
  });
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [section, setSection] = useState("overview");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [aiResult, setAiResult] = useState("");

  useEffect(() => {
    Papa.parse(GOOGLE_SHEET_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows((results.data || []).map(normalizeRow));
        setLoading(false);
      },
      error: (err) => {
        setLoadError(err?.message || "Unable to load Google Sheet.");
        setLoading(false);
      },
    });
  }, []);

  const options = useMemo(() => {
    const out = {};
    FILTER_FIELDS.forEach(([key]) => {
      out[key] = [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      );
    });
    return out;
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((r) =>
        FILTER_FIELDS.every(([key]) => {
          const selected = filters[key] || [];
          return selected.length === 0 || selected.includes(String(r[key]));
        })
      ),
    [rows, filters]
  );

  const kpi = useMemo(() => aggregate(filteredRows), [filteredRows]);
  const overallKpi = useMemo(() => aggregate(rows), [rows]);
  const trend = useMemo(() => monthly(filteredRows), [filteredRows]);

  const overviewMetrics = useMemo(() => {
    const totalAmount = kpi.approvedAmt + kpi.declinedAmt;
    return {
      totalAmount,
      approvalRateByAmount: pct(kpi.approvedAmt, totalAmount),
      approvalRateByCount: kpi.approvalRate,
      fraudRateBps: kpi.fraudRate * 100,
      chargebackRateBps: kpi.cbRate * 100,
      overallApprovalRateByCount: overallKpi.approvalRate,
    };
  }, [kpi, overallKpi]);

  const channelMix = useMemo(
    () =>
      groupBy(filteredRows, "channel").map((x) => ({
        ...x,
        approved: filteredRows
          .filter((r) => (r.channel || "Unknown") === x.name)
          .reduce((s, r) => s + n(r["approved count"]), 0),
      })),
    [filteredRows]
  );

  const declineReasons = useMemo(
    () =>
      groupBy(filteredRows, "response_description", (r) => n(r["decline count"])).slice(0, 8),
    [filteredRows]
  );

  const fraudReasons = useMemo(
    () => groupBy(filteredRows, "fraud reason", (r) => n(r["fraud count"])).filter((x) => x.name !== "Unknown").slice(0, 8),
    [filteredRows]
  );

  const cbReasons = useMemo(
    () =>
      groupBy(filteredRows, "chargeback reason", (r) => n(r["chargeback count"]))
        .filter((x) => x.name !== "Unknown")
        .slice(0, 8),
    [filteredRows]
  );

  const channelRates = useMemo(() => groupRates(filteredRows, "channel"), [filteredRows]);

  const acquirerTrend = useMemo(
  () => acquirerMonthly(filteredRows),
  [filteredRows]
);

const performance3DS = useMemo(
  () => categoryMetrics(filteredRows, "3DS"),
  [filteredRows]
);

const performanceTokenization = useMemo(
  () => categoryMetrics(filteredRows, "tokenization"),
  [filteredRows]
);

const performanceEntryMode = useMemo(
  () => categoryMetrics(filteredRows, "entry mode code"),
  [filteredRows]
);

const performanceWallet = useMemo(
  () => categoryMetrics(filteredRows, "wallet"),
  [filteredRows]
);

const ticketDeclineData = useMemo(
  () => ticketDeclineMix(filteredRows),
  [filteredRows]
);

  const aiContext = useMemo(() => ({
    view: SECTIONS.find(([id]) => id === section)?.[1] || section,
    filters: Object.fromEntries(
      Object.entries(filters).filter(([, value]) => Array.isArray(value) && value.length > 0)
    ),
    rowsInScope: filteredRows.length,
    kpis: {
      authorizationTransactions: kpi.total,
      approvedTransactions: kpi.approved,
      declinedTransactions: kpi.declined,
      approvalRate: kpi.approvalRate,
      declineRate: kpi.declineRate,
      approvedAmount: kpi.approvedAmt,
      declinedAmount: kpi.declinedAmt,
      fraudTransactions: kpi.fraud,
      fraudRate: kpi.fraudRate,
      fraudAmount: kpi.fraudAmt,
      chargebackTransactions: kpi.cb,
      chargebackRate: kpi.cbRate,
      chargebackAmount: kpi.cbAmt,
    },
    monthlyVolume: trend.slice(-12),
    channelApprovalRates: channelRates,
    declineDrivers: declineReasons,
    fraudDrivers: fraudReasons,
    chargebackDrivers: cbReasons,
  }), [
    section, filters, filteredRows.length, kpi, trend, channelRates, declineReasons, fraudReasons, cbReasons
  ]);

  async function generateInsights() {
    setAiLoading(true);
    setAiStatus("Generating insights…");
    setAiResult("");
    const controller = new AbortController();
    try {
      const response = await fetch(AI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          model: selectedModel.model,
          dashboardData: aiContext,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "AI request failed.");
      }
      setAiResult(payload.insights || "No insights were returned.");
      setAiStatus("Insights generated");
    } catch (err) {
      if (err?.name === "AbortError") setAiStatus("Generation stopped");
      else {
        setAiStatus("Generation failed");
        setAiResult(`Unable to generate insights: ${err?.message || "Unknown error"}`);
      }
    } finally {
      setAiLoading(false);
    }
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="loader-orb" />
        <div>
          <div className="eyebrow">PAYMENTS INTELLIGENCE</div>
          <h1>Loading authorization data</h1>
          <p>Connecting to the live Google Sheets data source…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app loading-screen">
        <div>
          <div className="eyebrow">DATA CONNECTION ERROR</div>
          <h1>Unable to load the dashboard data</h1>
          <p>{loadError}</p>
          <p className="muted">Check that the Google Sheet is shared for viewing and try refreshing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">Authorization</div>
            <div className="brand-sub">INTELLIGENCE</div>
          </div>
        </div>

        <div className="side-label">GLOBAL FILTERS</div>
        <div className="filter-groups">
          {FILTER_GROUPS.map((group) => (
            <FilterGroup
              key={group.key}
              group={group}
              filters={filters}
              options={options}
              setFilters={setFilters}
            />
          ))}
        </div>
        <button className="reset-btn" onClick={resetFilters}>Reset all filters</button>

        <div className="sidebar-foot">
          <span className="live-dot" />
          <span>Live Google Sheets source</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">PAYMENTS ANALYTICS</div>
            <h1>Authorization Intelligence</h1>
          </div>
          <div className="top-actions">
            <div className="scope-pill">
              <span>{number(filteredRows.length)}</span> rows in scope
            </div>
            <button className="ai-button" onClick={() => setAiOpen(true)}>
              <span className="spark">✦</span> AI Insights
            </button>
          </div>
        </header>

        <nav className="tabs">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "tab active" : "tab"}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <section className="content">
          <div className="context-line">
            <span>Current view: <strong>{SECTIONS.find(([id]) => id === section)?.[1]}</strong></span>
            <span>Filtered authorization activity</span>
          </div>

          {section === "overview" ? (
            <div className="kpi-grid">
              <Kpi label="Total Amount" value={money(overviewMetrics.totalAmount)} sub="approved + declined amount" />
              <Kpi label="Total Count" value={number(kpi.total)} sub="approved + declined transactions" />
              <Kpi label="Approval Rate by Amount" value={rate(overviewMetrics.approvalRateByAmount)} sub="approved amount / total amount" />
              <Kpi label="Approval Rate by Count" value={rate(overviewMetrics.approvalRateByCount)} sub="approved count / total count" />
              <Kpi label="Fraud Rate (BPS)" value={bps(overviewMetrics.fraudRateBps)} sub={`${number(kpi.fraud)} fraud transactions`} />
              <Kpi label="Chargeback Rate (BPS)" value={bps(overviewMetrics.chargebackRateBps)} sub={`${number(kpi.cb)} chargebacks`} />
              <Kpi label="Overall Approval Rate by Count (Static)" value={rate(overviewMetrics.overallApprovalRateByCount)} sub="overall dataset · unaffected by filters" />
            </div>
          ) : (
            <div className="kpi-grid">
              <Kpi label="Authorization Volume" value={number(kpi.total)} sub="approved + declined" />
              <Kpi label="Approval Rate" value={rate(kpi.approvalRate)} sub={`${number(kpi.approved)} approved`} />
              <Kpi label="Approved Value" value={money(kpi.approvedAmt)} sub="approved transaction value" />
              <Kpi label="Decline Rate" value={rate(kpi.declineRate)} sub={`${number(kpi.declined)} declined`} />
              <Kpi label="Fraud Rate" value={rate(kpi.fraudRate)} sub={`${number(kpi.fraud)} fraud transactions`} />
              <Kpi label="Chargeback Rate" value={rate(kpi.cbRate)} sub={`${number(kpi.cb)} chargebacks`} />
            </div>
          )}

          <AnimatePresence mode="wait">
            {section === "overview" && (
              <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="chart-grid two">
                  <ChartCard title="Authorization trend" subtitle="Approval rate by amount and count">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={trend.map((x) => ({
                          ...x,
                          approvalRateByAmount: pct(x.approvedAmt, x.approvedAmt + x.declineAmt),
                          approvalRateByCount: x.approvalRate,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis
                          domain={([dataMin, dataMax]) => {
                            const range = dataMax - dataMin;
                            const padding = Math.max(range * 0.25, 0.5);
                            return [
                              Math.max(0, dataMin - padding),
                              Math.min(100, dataMax + padding),
                            ];
                          }}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => `${v.toFixed(1)}%`}
                        />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="approvalRateByAmount"
                          name="Approval Rate by Amount"
                          stroke="#46b5ff"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="approvalRateByCount"
                          name="Approval Rate by Count"
                          stroke="#66d4a6"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                  <ChartCard title="Approved volume by channel" subtitle="Transaction mix across channels">
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={channelMix}
                          dataKey="approved"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={105}
                          innerRadius={55}
                          paddingAngle={2}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                        >
                          {channelMix.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={["#46b5ff", "#66d4a6", "#ffb86b", "#ff6b87"][index % 4]}
                            />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => number(v)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
                <div className="chart-grid two">
                  <ChartCard title="Top decline drivers" subtitle="% of total declined transactions by response description">
                    <SimpleBars
                      data={declineReasons.map((x) => ({
                        ...x,
                        value: pct(x.value, kpi.declined),
                      }))}
                      valueSuffix="%"
                    />
                  </ChartCard>
                  <ChartCard title="Transaction mix" subtitle="Network and product mix by transaction count">
                    <div className="mix-bars">
                  
                      <div className="mix-section">
                        <div className="mix-header">
                          <span>Card Network</span>
                        </div>
                  
                        <div className="mix-bar">
                          {(() => {
                            const visa = filteredRows
                              .filter((r) => String(r.bin || "").startsWith("4"))
                              .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                            const mastercard = filteredRows
                              .filter((r) => String(r.bin || "").startsWith("5"))
                              .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                            const total = visa + mastercard;
                            const visaPct = pct(visa, total);
                            const mcPct = pct(mastercard, total);
                  
                            return (
                              <>
                                <div
                                  className="mix-segment visa"
                                  style={{ width: `${visaPct}%` }}
                                />
                                <div
                                  className="mix-segment mastercard"
                                  style={{ width: `${mcPct}%` }}
                                />
                              </>
                            );
                          })()}
                        </div>
                  
                        {(() => {
                          const visa = filteredRows
                            .filter((r) => String(r.bin || "").startsWith("4"))
                            .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                          const mastercard = filteredRows
                            .filter((r) => String(r.bin || "").startsWith("5"))
                            .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                          const total = visa + mastercard;
                  
                          return (
                            <div className="mix-legend">
                              <span><i className="mix-dot visa-dot" /> Visa <strong>{pct(visa, total).toFixed(1)}%</strong></span>
                              <span><i className="mix-dot mastercard-dot" /> Mastercard <strong>{pct(mastercard, total).toFixed(1)}%</strong></span>
                            </div>
                          );
                        })()}
                      </div>
                  
                      <div className="mix-section">
                        <div className="mix-header">
                          <span>Product Type</span>
                        </div>
                  
                        <div className="mix-bar">
                          {(() => {
                            const credit = filteredRows
                              .filter((r) => String(r["prod type"]).toLowerCase().includes("credit"))
                              .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                            const debit = filteredRows
                              .filter((r) => String(r["prod type"]).toLowerCase().includes("debit"))
                              .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                            const prepaid = filteredRows
                              .filter((r) => String(r["prod type"]).toLowerCase().includes("prepaid"))
                              .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                            const total = credit + debit + prepaid;
                  
                            return (
                              <>
                                <div
                                  className="mix-segment credit"
                                  style={{ width: `${pct(credit, total)}%` }}
                                />
                                <div
                                  className="mix-segment debit"
                                  style={{ width: `${pct(debit, total)}%` }}
                                />
                                <div
                                  className="mix-segment prepaid"
                                  style={{ width: `${pct(prepaid, total)}%` }}
                                />
                              </>
                            );
                          })()}
                        </div>
                  
                        {(() => {
                          const credit = filteredRows
                            .filter((r) => String(r["prod type"]).toLowerCase().includes("credit"))
                            .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                          const debit = filteredRows
                            .filter((r) => String(r["prod type"]).toLowerCase().includes("debit"))
                            .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                          const prepaid = filteredRows
                            .filter((r) => String(r["prod type"]).toLowerCase().includes("prepaid"))
                            .reduce((s, r) => s + n(r["approved count"]) + n(r["decline count"]), 0);
                  
                          const total = credit + debit + prepaid;
                  
                          return (
                            <div className="mix-legend">
                              <span><i className="mix-dot credit-dot" /> Credit <strong>{pct(credit, total).toFixed(1)}%</strong></span>
                              <span><i className="mix-dot debit-dot" /> Debit <strong>{pct(debit, total).toFixed(1)}%</strong></span>
                              <span><i className="mix-dot prepaid-dot" /> Prepaid <strong>{pct(prepaid, total).toFixed(1)}%</strong></span>
                            </div>
                          );
                        })()}
                      </div>
                  
                    </div>
                  </ChartCard>
                </div>
              </motion.div>
            )}

            {section === "performance" && (
              <motion.div
                key="performance"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
            
                {/* ROW 1 — ACQUIRER APPROVAL TREND */}
                <ChartCard
                  title="Approval Rate by Acquirer"
                  subtitle="Monthly approval rate by transaction count"
                >
                  <ResponsiveContainer width="100%" height={420}>
                    <LineChart
                      data={acquirerTrend.data}
                      margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11 }}
                      />
                
                      <YAxis
                        domain={([dataMin, dataMax]) => {
                          const range = dataMax - dataMin;
                          const padding = Math.max(range * 0.25, 0.5);
                
                          return [
                            Math.max(0, dataMin - padding),
                            Math.min(100, dataMax + padding),
                          ];
                        }}
                        tickFormatter={(value) => `${value.toFixed(1)}%`}
                        tick={{ fontSize: 11 }}
                      />
                
                      <Tooltip
                        formatter={(value, name) => [
                          `${Number(value).toFixed(2)}%`,
                          name,
                        ]}
                        labelFormatter={(label) => `Month: ${label}`}
                      />
                
                      {acquirerTrend.acquirers.map((acquirer, index) => (
                        <Line
                          key={acquirer}
                          type="monotone"
                          dataKey={acquirer}
                          name={acquirer}
                          stroke={[
                            "#46b5ff",
                            "#66d4a6",
                            "#ffb86b",
                            "#ff6b87",
                            "#8b7cf6",
                            "#20b2aa",
                            "#45aaf2",
                            "#a55eea",
                            "#26de81",
                            "#fd9644",
                            "#fc5c65",
                            "#2bcbba",
                          ][index % 12]}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
            
            
                {/* ROW 2 — FOUR PIE CHARTS */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: "14px",
                    marginTop: "16px",
                  }}
                >
            
                  <PerformancePie
                    title="3DS"
                    subtitle="Transaction share"
                    data={performance3DS}
                  />
            
                  <PerformancePie
                    title="Tokenization"
                    subtitle="Transaction share"
                    data={performanceTokenization}
                  />
            
                  <PerformancePie
                    title="Entry Mode"
                    subtitle="Transaction share"
                    data={performanceEntryMode}
                  />
            
                  <PerformancePie
                    title="Wallet"
                    subtitle="Transaction share"
                    data={performanceWallet}
                  />
            
                </div>
            
            
                {/* ROW 3 — TICKET SIZE × DECLINE REASON */}
                <div style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="Decline Reason Mix by Ticket Size"
                    subtitle="Top 4 decline reasons within each ticket size band"
                  >
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart
                        data={ticketDeclineData}
                        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  
                        <XAxis
                          dataKey="ticket"
                          tick={{ fontSize: 11 }}
                        />
                  
                        <YAxis
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                          tick={{ fontSize: 11 }}
                        />
                  
                        <Tooltip
                          formatter={(value, name, props) => {
                            const reasonName =
                              props?.payload?.[`${name}_name`] || name;
                  
                            return [`${Number(value).toFixed(1)}%`, reasonName];
                          }}
                        />
                  
                        <Bar dataKey="reason_0" stackId="declines" fill="#46b5ff" />
                        <Bar dataKey="reason_1" stackId="declines" fill="#66d4a6" />
                        <Bar dataKey="reason_2" stackId="declines" fill="#ffb86b" />
                        <Bar dataKey="reason_3" stackId="declines" fill="#ff6b87" />
                        <Bar dataKey="reason_others" stackId="declines" fill="#8b7cf6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
            
              </motion.div>
            )}

            {section === "decline" && (
              <motion.div key="decline" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="kpi-grid compact">
                  <Kpi label="Declined Transactions" value={number(kpi.declined)} sub="transactions" />
                  <Kpi label="Declined Value" value={money(kpi.declinedAmt)} sub="declined amount" />
                  <Kpi label="Decline Rate" value={rate(kpi.declineRate)} sub="of authorization volume" />
                </div>
                <div className="chart-grid two">
                  <ChartCard title="Decline reason distribution" subtitle="Top response descriptions">
                    <SimpleBars data={declineReasons} />
                  </ChartCard>
                  <ChartCard title="Decline rate by channel" subtitle="Channel-level decline exposure">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={channelRates.map((x) => ({ ...x, decline: 100 - x.approval }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                        <Bar dataKey="decline" name="Decline Rate" fill="#ff6b87" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
              </motion.div>
            )}

            {section === "risk" && (
              <motion.div key="risk" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="kpi-grid compact">
                  <Kpi label="Fraud Transactions" value={number(kpi.fraud)} sub={`${rate(kpi.fraudRate)} of approved`} />
                  <Kpi label="Fraud Exposure" value={money(kpi.fraudAmt)} sub="fraud amount" />
                  <Kpi label="Chargebacks" value={number(kpi.cb)} sub={`${rate(kpi.cbRate)} of approved`} />
                  <Kpi label="Chargeback Exposure" value={money(kpi.cbAmt)} sub="chargeback total" />
                </div>
                <div className="chart-grid two">
                  <ChartCard title="Fraud reason distribution" subtitle="Fraud counts by reason">
                    <SimpleBars data={fraudReasons} />
                  </ChartCard>
                  <ChartCard title="Chargeback reason distribution" subtitle="Chargeback counts by reason">
                    <SimpleBars data={cbReasons} />
                  </ChartCard>
                </div>
                <ChartCard title="Fraud rate by channel" subtitle="Fraud transactions as a percentage of approved transactions">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={channelRates}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                      <Bar dataKey="fraud" name="Fraud Rate" fill="#ffb86b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      <AnimatePresence>
        {aiOpen && (
          <>
            <motion.div className="drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAiOpen(false)} />
            <motion.aside className="ai-drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}>
              <div className="drawer-head">
                <div>
                  <div className="eyebrow">AI ASSISTANT</div>
                  <h2>AI Insights</h2>
                </div>
                <button className="icon-btn" onClick={() => setAiOpen(false)}>×</button>
              </div>

              <div className="ai-controls">
                <label>
                  <span>AI Model</span>
                  <select
                    value={`${selectedModel.provider}|${selectedModel.model}`}
                    onChange={(e) => {
                      const found = MODEL_OPTIONS.find(
                        (x) => `${x.provider}|${x.model}` === e.target.value
                      );
                      if (found) setSelectedModel(found);
                    }}
                  >
                    {MODEL_OPTIONS.map((x) => (
                      <option key={`${x.provider}|${x.model}`} value={`${x.provider}|${x.model}`}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="generate-btn" onClick={generateInsights} disabled={aiLoading}>
                  {aiLoading ? "Generating…" : "Generate Insights"}
                </button>
                <div className="ai-status">{aiStatus || "Ready"}</div>
              </div>

              <div className="ai-context">
                <div className="context-title">CONTEXT</div>
                <div className="context-grid">
                  <span>View</span><strong>{aiContext.view}</strong>
                  <span>Rows</span><strong>{number(aiContext.rowsInScope)}</strong>
                  <span>Approval</span><strong>{rate(kpi.approvalRate)}</strong>
                  <span>Decline</span><strong>{rate(kpi.declineRate)}</strong>
                  <span>Fraud</span><strong>{rate(kpi.fraudRate)}</strong>
                  <span>Chargeback</span><strong>{rate(kpi.cbRate)}</strong>
                </div>
              </div>

              <div className="ai-result">
                {aiResult ? (
                  <div className="insight-text">{aiResult}</div>
                ) : (
                  <div className="empty-ai">
                    <div className="empty-spark">✦</div>
                    <h3>Generate an analytical readout</h3>
                    <p>The AI will use the current filters, KPIs, trends, decline drivers, fraud and chargeback signals.</p>
                  </div>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterGroup({ group, filters, options, setFilters }) {
  const [open, setOpen] = useState(null);

  function toggleValue(key, value) {
    setFilters((current) => {
      const selected = current[key] || [];
      const next = selected.includes(value)
        ? selected.filter((x) => x !== value)
        : [...selected, value];
      return { ...current, [key]: next };
    });
  }

  function clearField(key) {
    setFilters((current) => ({ ...current, [key]: [] }));
  }

  return (
    <div className="filter-group">
      <div className="filter-group-title">
        <span className="filter-group-icon">{group.icon}</span>
        <span>{group.label}</span>
      </div>
      <div className="filter-group-fields">
        {group.fields.map(([key, label]) => {
          const selected = filters[key] || [];
          const values = options[key] || [];
          const isOpen = open === key;
          const summary = selected.length === 0 ? "All" : selected.length === 1 ? selected[0] : `${selected.length} selected`;

          return (
            <div className="multi-filter" key={key}>
              <button type="button" className={`multi-filter-trigger ${selected.length ? "has-selection" : ""}`} onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                <span className="multi-filter-label">{label}</span>
                <span className="multi-filter-summary">{summary}</span>
                <span className="multi-filter-chevron">⌄</span>
              </button>
              {isOpen && (
                <>
                  <button type="button" className="filter-popover-backdrop" aria-label="Close filter" onClick={() => setOpen(null)} />
                  <div className="filter-popover">
                    <div className="filter-popover-head">
                      <span>{label}</span>
                      {selected.length > 0 && <button type="button" onClick={() => clearField(key)}>Clear</button>}
                    </div>
                    <div className="filter-options">
                      {values.map((value) => (
                        <label className="filter-option" key={value}>
                          <input type="checkbox" checked={selected.includes(String(value))} onChange={() => toggleValue(key, String(value))} />
                          <span>{value}</span>
                        </label>
                      ))}
                      {!values.length && <div className="filter-empty">No values available</div>}
                    </div>
                    <button type="button" className="filter-done" onClick={() => setOpen(null)}>Done</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function PerformancePie({ title, subtitle, data }) {
  const colors = [
    "#46b5ff",
    "#66d4a6",
    "#ffb86b",
    "#ff6b87",
    "#8b7cff",
    "#20b2aa",
    "#d88928",
    "#7c8cff",
  ];

  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="totalCount"
            nameKey="name"
            cx="50%"
            cy="48%"
            outerRadius={78}
            innerRadius={38}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell
                key={`performance-pie-${index}`}
                fill={colors[index % colors.length]}
              />
            ))}
          </Pie>

          <Tooltip
            formatter={(value, name, props) => {
              const x = props?.payload;

              return [
                `${Number(x?.share || 0).toFixed(1)}%`,
                "Transaction Share",
              ];
            }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;

              const x = payload[0].payload;

              return (
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e3eaf2",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    boxShadow: "0 6px 18px rgba(24,38,56,.12)",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      marginBottom: "6px",
                      color: "#182638",
                    }}
                  >
                    {x.name}
                  </div>

                  <div style={{ fontSize: "11px", color: "#718096" }}>
                    Transaction Share:{" "}
                    <strong style={{ color: "#182638" }}>
                      {x.share.toFixed(1)}%
                    </strong>
                  </div>

                  <div style={{ fontSize: "11px", color: "#718096" }}>
                    Approval Rate — Count:{" "}
                    <strong style={{ color: "#182638" }}>
                      {x.approvalRateByCount.toFixed(2)}%
                    </strong>
                  </div>

                  <div style={{ fontSize: "11px", color: "#718096" }}>
                    Approval Rate — Amount:{" "}
                    <strong style={{ color: "#182638" }}>
                      {x.approvalRateByAmount.toFixed(2)}%
                    </strong>
                  </div>
                </div>
              );
            }}
          />

          <Legend
            wrapperStyle={{
              fontSize: "11px",
              lineHeight: "16px",
            }}
            iconSize={10}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
function Kpi({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function SimpleBars({ data }) {
  const max = Math.max(...data.map((x) => x.value), 1);
  return (
    <div className="simple-bars">
      {data.map((x) => (
        <div className="simple-bar-row" key={x.name}>
          <div className="simple-bar-label" title={x.name}>{x.name}</div>
          <div className="simple-bar-track">
            <div className="simple-bar-fill" style={{ width: `${(x.value / max) * 100}%` }} />
          </div>
          <div className="simple-bar-value">{number(x.value)}</div>
        </div>
      ))}
    </div>
  );
}

function RiskMetric({ label, value, rate }) {
  return (
    <div className="risk-metric">
      <div className="risk-label">{label}</div>
      <div className="risk-value">{value}</div>
      <div className="risk-rate">{rate}</div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
