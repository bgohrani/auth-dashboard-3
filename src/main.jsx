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
  ComposedChart,
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
import { GOOGLE_SHEET_CSV_URL, AUTHENTICATION_DATA_URL, AI_API_URL } from "./dataSource";
import "./styles.css";

const SECTIONS = [
  ["overview", "Overview"],
  ["performance", "Authorization Performance"],
  ["decline", "Decline Analysis"],
  ["risk", "Fraud & Chargebacks"],
  ["authentication", "Authentication"],
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
  {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
  },
  {
  provider: "huggingface",
  model: "meta-llama/Llama-3.3-70B-Instruct",
  label: "Llama 3.3 70B · Hugging Face",
  },
  {
  provider: "huggingface",
  model: "deepseek-ai/DeepSeek-V3-0324",
  label: "DeepSeek V3 · Hugging Face",
  },
  {
  provider: "nvidia",
  model: "nvidia/nemotron-3-super-120b-a12b",
  label: "Nemotron 3 Super 120B · NVIDIA",
  }
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

function topAmountApproval(rows, key) {
  const map = new Map();

  rows.forEach((r) => {
    const name = String(r[key] ?? "").trim();

    if (!name) return;

    const approved = n(r["approved count"]);
    const declined = n(r["decline count"]);
    const approvedAmt = n(r["approved amt"]);
    const declineAmt = n(r["decline amount"]);

    const current = map.get(name) || {
      name,
      totalAmount: 0,
      approved: 0,
      declined: 0,
    };

    current.totalAmount += approvedAmt + declineAmt;
    current.approved += approved;
    current.declined += declined;

    map.set(name, current);
  });

  const data = [...map.values()]
    .map((x) => ({
      ...x,
      approvalRate: pct(x.approved, x.approved + x.declined),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10);

  if (!data.length) return data;

  const minAmount = Math.min(...data.map((x) => x.totalAmount));
  const maxAmount = Math.max(...data.map((x) => x.totalAmount));
  const minRate = Math.min(...data.map((x) => x.approvalRate));
  const maxRate = Math.max(...data.map((x) => x.approvalRate));

  const amountRange = Math.max(maxAmount - minAmount, 1);
  const rateRange = Math.max(maxRate - minRate, 0.01);

  return data.map((x) => ({
    ...x,
    // Visual position only: keeps the approval-rate line dynamically
    // between the bars while preserving the actual rate for the tooltip.
    approvalRateVisual:
      minAmount +
      amountRange *
        (0.25 + 0.5 * ((x.approvalRate - minRate) / rateRange)),
  }));
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

    // Exclude blank / null values completely
    if (!value) return;

    const approved = n(r["approved count"]);
    const declined = n(r["decline count"]);
    const approvedAmt = n(r["approved amt"]);
    const declineAmt = n(r["decline amount"]);

    if (!map.has(value)) {
      map.set(value, {
        name: value,
        totalCount: 0,
        approved: 0,
        approvedAmt: 0,
        totalAmt: 0,
      });
    }

    const x = map.get(value);

    x.totalCount += approved + declined;
    x.approved += approved;
    x.approvedAmt += approvedAmt;
    x.totalAmt += approvedAmt + declineAmt;
  });

  const totalCount = [...map.values()].reduce(
    (sum, x) => sum + x.totalCount,
    0
  );

  return [...map.values()].map((x) => ({
    ...x,
    share: pct(x.totalCount, totalCount),
    approvalRateByCount: pct(x.approved, x.totalCount),
    approvalRateByAmount: pct(x.approvedAmt, x.totalAmt),
  }));
}

function primaryCategoryApprovalRate(data, preferredPattern) {
  const negativePattern = /non|not|no|false|^0$/i;
  const preferred = data.find(
    (x) => preferredPattern.test(String(x.name)) && !negativePattern.test(String(x.name))
  );
  if (preferred) return preferred.approvalRateByCount;

  const positive = data.find(
    (x) => !negativePattern.test(String(x.name))
  );
  return positive ? positive.approvalRateByCount : 0;
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


function declineMonthlyTrend(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const month = String(r.year_month ?? "").trim() || "NA";

    if (!map.has(month)) {
      map.set(month, {
        month,
        declined: 0,
        declineAmount: 0,
        total: 0,
      });
    }

    const x = map.get(month);

    x.declined += n(r["decline count"]);
    x.declineAmount += n(r["decline amount"]);
    x.total += n(r["approved count"]) + n(r["decline count"]);
  });

  const data = [...map.values()]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((x) => ({
      ...x,
      declineRate: pct(x.declined, x.total),
    }));

  if (!data.length) return data;

  const minAmount = Math.min(...data.map((x) => x.declineAmount));
  const maxAmount = Math.max(...data.map((x) => x.declineAmount));

  const minRate = Math.min(...data.map((x) => x.declineRate));
  const maxRate = Math.max(...data.map((x) => x.declineRate));

  const amountRange = Math.max(maxAmount - minAmount, 1);
  const rateRange = Math.max(maxRate - minRate, 0.01);

  return data.map((x) => ({
    ...x,

    // Visual position of the decline-rate line on the same axis.
    // Keeps the line in the middle of the chart while preserving
    // the actual declineRate value for the tooltip.
    declineRateVisual:
      minAmount +
      amountRange *
        (0.25 +
          0.5 * ((x.declineRate - minRate) / rateRange)),
  }));
}

function declineReasonMixByDimension(rows, key, limit = null) {
  const dimensionMap = new Map();

  rows.forEach((r) => {
    const dimension = String(r[key] ?? "").trim();

    if (!dimension) return;

    const reason = String(r.response_description ?? "").trim() || "NA";
    const count = n(r["decline count"]);

    if (!dimensionMap.has(dimension)) {
      dimensionMap.set(dimension, new Map());
    }

    const reasonMap = dimensionMap.get(dimension);
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + count);
  });

  let dimensions = [...dimensionMap.entries()]
    .map(([dimension, reasonMap]) => ({
      dimension,
      total: [...reasonMap.values()].reduce((sum, value) => sum + value, 0),
      reasonMap,
    }))
    .sort((a, b) => b.total - a.total);

  if (limit) {
    dimensions = dimensions.slice(0, limit);
  }

  return dimensions.map(({ dimension, reasonMap }) => {
    const sorted = [...reasonMap.entries()]
      .sort((a, b) => b[1] - a[1]);

    const top4 = sorted.slice(0, 4);
    const others = sorted
      .slice(4)
      .reduce((sum, [, value]) => sum + value, 0);

    const total = sorted.reduce((sum, [, value]) => sum + value, 0);

    const row = {
      dimension,
      total,
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

function topDeclineAmountByDimension(rows, key, limit = 10) {
  const map = new Map();

  rows.forEach((r) => {
    const dimension = String(r[key] ?? "").trim();

    if (!dimension) return;

    const declineAmount = n(r["decline amount"]);

    if (!map.has(dimension)) {
      map.set(dimension, {
        name: dimension,
        declineAmount: 0,
      });
    }

    map.get(dimension).declineAmount += declineAmount;
  });

  const totalDeclineAmount = [...map.values()].reduce(
    (sum, x) => sum + x.declineAmount,
    0
  );

  return [...map.values()]
    .map((x) => ({
      ...x,
      share: pct(x.declineAmount, totalDeclineAmount),
    }))
    .sort((a, b) => b.declineAmount - a.declineAmount)
    .slice(0, limit);
}

function fraudMonthlyTrend(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const month = String(r.year_month ?? "").trim() || "NA";

    if (!map.has(month)) {
      map.set(month, {
        month,
        fraud: 0,
        approved: 0,
      });
    }

    const x = map.get(month);

    x.fraud += n(r["fraud count"]);
    x.approved += n(r["approved count"]);
  });

  const data = [...map.values()]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((x) => ({
      ...x,
      fraudRateBps: x.approved ? (x.fraud / x.approved) * 10000 : 0,
    }));

  if (!data.length) return data;

  const minVolume = Math.min(...data.map((x) => x.fraud));
  const maxVolume = Math.max(...data.map((x) => x.fraud));

  const minRate = Math.min(...data.map((x) => x.fraudRateBps));
  const maxRate = Math.max(...data.map((x) => x.fraudRateBps));

  const volumeRange = Math.max(maxVolume - minVolume, 1);
  const rateRange = Math.max(maxRate - minRate, 0.01);

  return data.map((x) => ({
    ...x,
    fraudRateVisual:
      minVolume +
      volumeRange *
        (0.25 +
          0.5 * ((x.fraudRateBps - minRate) / rateRange)),
  }));
}


function chargebackMonthlyTrend(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const month = String(r.year_month ?? "").trim() || "NA";

    if (!map.has(month)) {
      map.set(month, {
        month,
        chargebacks: 0,
        approved: 0,
      });
    }

    const x = map.get(month);

    x.chargebacks += n(r["chargeback count"]);
    x.approved += n(r["approved count"]);
  });

  const data = [...map.values()]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((x) => ({
      ...x,
      chargebackRateBps: x.approved
        ? (x.chargebacks / x.approved) * 10000
        : 0,
    }));

  if (!data.length) return data;

  const minVolume = Math.min(...data.map((x) => x.chargebacks));
  const maxVolume = Math.max(...data.map((x) => x.chargebacks));

  const minRate = Math.min(...data.map((x) => x.chargebackRateBps));
  const maxRate = Math.max(...data.map((x) => x.chargebackRateBps));

  const volumeRange = Math.max(maxVolume - minVolume, 1);
  const rateRange = Math.max(maxRate - minRate, 0.01);

  return data.map((x) => ({
    ...x,
    chargebackRateVisual:
      minVolume +
      volumeRange *
        (0.25 +
          0.5 * ((x.chargebackRateBps - minRate) / rateRange)),
  }));
}


function chargebackLifecycleMix(rows) {
  let totalChargebacks = 0;
  let firstAmount = 0;
  let secondAmount = 0;
  let arbitrationAmount = 0;

  rows.forEach((r) => {
    totalChargebacks += n(r["chargeback count"]);
    firstAmount += n(r["first presentment amt"]);
    secondAmount += n(r["second presentment amt"]);
    arbitrationAmount += n(r["arbitration amt"]);
  });

  const totalLifecycleAmount =
    firstAmount + secondAmount + arbitrationAmount;

  const categories = [
    {
      name: "First Presentment",
      amount: firstAmount,
    },
    {
      name: "Second Presentment",
      amount: secondAmount,
    },
    {
      name: "Arbitration",
      amount: arbitrationAmount,
    },
  ];

  return categories.map((x) => ({
    ...x,
    count:
      totalLifecycleAmount > 0
        ? totalChargebacks * (x.amount / totalLifecycleAmount)
        : 0,
    share:
      totalChargebacks > 0
        ? (totalLifecycleAmount > 0
            ? totalChargebacks * (x.amount / totalLifecycleAmount)
            : 0) / totalChargebacks * 100
        : 0,
  }));
}


function authenticationMetrics(rows) {
  let total = 0;
  let success = 0;
  let challengeTotal = 0;
  let challengeSuccess = 0;
  let frictionlessTotal = 0;
  let frictionlessSuccess = 0;

  rows.forEach((r) => {
    const count = n(r["authentication_txn_count"]);
    const result = String(r.authentication_result ?? "").trim();
    const mode = String(r.challenge_frictionless_flag ?? "").trim();

    total += count;

    if (result === "Authenticated") {
      success += count;
    }

    if (mode === "Challenge") {
      challengeTotal += count;
      if (result === "Authenticated") challengeSuccess += count;
    }

    if (mode === "Frictionless") {
      frictionlessTotal += count;
      if (result === "Authenticated") frictionlessSuccess += count;
    }
  });

  return {
    total,
    success,
    successRate: pct(success, total),
    challengeSuccessRate: pct(challengeSuccess, challengeTotal),
    frictionlessSuccessRate: pct(frictionlessSuccess, frictionlessTotal),
  };
}

function authenticationMonthly(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const month = String(r.yearmonth ?? "").trim() || "NA";
    const count = n(r["authentication_txn_count"]);
    const result = String(r.authentication_result ?? "").trim();

    const x = map.get(month) || { month, volume: 0, success: 0 };
    x.volume += count;
    if (result === "Authenticated") x.success += count;
    map.set(month, x);
  });

  const data = [...map.values()]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((x) => ({
      ...x,
      successRate: pct(x.success, x.volume),
    }));

  if (!data.length) return data;

  const minVolume = Math.min(...data.map((x) => x.volume));
  const maxVolume = Math.max(...data.map((x) => x.volume));
  const minRate = Math.min(...data.map((x) => x.successRate));
  const maxRate = Math.max(...data.map((x) => x.successRate));

  const volumeRange = Math.max(maxVolume - minVolume, 1);
  const rateRange = Math.max(maxRate - minRate, 0.01);

  return data.map((x) => ({
    ...x,
    // Visual position only: keeps the rate line dynamically centered
    // on the volume axis while preserving the actual rate for the tooltip.
    successRateVisual:
      minVolume +
      volumeRange *
        (0.25 + 0.5 * ((x.successRate - minRate) / rateRange)),
  }));
}

function authenticationMix(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const mode = String(r.challenge_frictionless_flag ?? "").trim();
    if (!mode) return;

    const count = n(r["authentication_txn_count"]);
    const success =
      String(r.authentication_result ?? "").trim() === "Authenticated"
        ? count
        : 0;

    const current = map.get(mode) || { value: 0, success: 0 };
    current.value += count;
    current.success += success;
    map.set(mode, current);
  });

  const total = [...map.values()].reduce((sum, x) => sum + x.value, 0);

  return [...map.entries()]
    .map(([name, x]) => ({
      name,
      value: x.value,
      share: pct(x.value, total),
      successRate: pct(x.success, x.value),
    }))
    .sort((a, b) => b.value - a.value);
}

function topAuthenticationFailures(rows, limit = 5) {
  const map = new Map();

  rows.forEach((r) => {
    const result = String(r.authentication_result ?? "").trim();
    const reason = String(r.decline_reason ?? "").trim();

    if (result !== "Not Authenticated" || !reason || reason === "Not applicable") {
      return;
    }

    const count = n(r["authentication_txn_count"]);
    map.set(reason, (map.get(reason) || 0) + count);
  });

  const total = [...map.values()].reduce((sum, value) => sum + value, 0);

  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      value,
      share: pct(value, total),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function topAuthenticationMandates(rows, limit = 5) {
  const map = new Map();

  rows.forEach((r) => {
    const mandate = String(r.challenge_mandate ?? "").trim();
    if (!mandate) return;

    const count = n(r["authentication_txn_count"]);
    map.set(mandate, (map.get(mandate) || 0) + count);
  });

  const total = [...map.values()].reduce((sum, value) => sum + value, 0);

  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      value,
      share: pct(value, total),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function topAuthenticationDimension(rows, key, limit = 10) {
  const map = new Map();

  rows.forEach((r) => {
    const name = String(r[key] ?? "").trim();
    if (!name) return;

    const count = n(r["authentication_txn_count"]);
    const success =
      String(r.authentication_result ?? "").trim() === "Authenticated"
        ? count
        : 0;

    const current = map.get(name) || {
      name,
      count: 0,
      success: 0,
    };

    current.count += count;
    current.success += success;
    map.set(name, current);
  });

  return [...map.values()]
    .map((x) => ({
      ...x,
      successRate: pct(x.success, x.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function AuthFilterBar({ filters, options, setFilters }) {
  const fields = [
    ["yearmonth", "Year Month"],
    ["issuer_name", "Issuer Name"],
    ["issuer_country", "Issuer Country"],
    ["acquirer_name", "Acquirer Name"],
    ["BIN", "MC-VISA"],
  ];

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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: "10px",
        marginBottom: "16px",
      }}
    >
      {fields.map(([key, label]) => {
        const selected = filters[key] || [];
        const values = options[key] || [];
        const isOpen = open === key;
        const summary =
          selected.length === 0
            ? "All"
            : selected.length === 1
              ? selected[0]
              : `${selected.length} selected`;

        return (
          <div className="multi-filter" key={key} style={{ position: "relative" }}>
            <button
              type="button"
              className={`multi-filter-trigger ${selected.length ? "has-selection" : ""}`}
              onClick={() => setOpen(isOpen ? null : key)}
              aria-expanded={isOpen}
            >
              <span className="multi-filter-label">{label}</span>
              <span className="multi-filter-summary">{summary}</span>
              <span className="multi-filter-chevron">⌄</span>
            </button>

            {isOpen && (
              <>
                <button
                  type="button"
                  className="filter-popover-backdrop"
                  aria-label="Close filter"
                  onClick={() => setOpen(null)}
                />
                <div className="filter-popover">
                  <div className="filter-popover-head">
                    <span>{label}</span>
                    {selected.length > 0 && (
                      <button type="button" onClick={() => clearField(key)}>
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="filter-options">
                    {values.map((value) => (
                      <label className="filter-option" key={value}>
                        <input
                          type="checkbox"
                          checked={selected.includes(String(value))}
                          onChange={() => toggleValue(key, String(value))}
                        />
                        <span>{value}</span>
                      </label>
                    ))}
                    {!values.length && (
                      <div className="filter-empty">No values available</div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="filter-done"
                    onClick={() => setOpen(null)}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderAIResult(text) {
  if (!text) return null;

  const sectionNames = [
    "EXECUTIVE STORYLINE",
    "KEY OBSERVATIONS",
    "AREAS REQUIRING ATTENTION",
    "DECLINE REDUCTION & MITIGATION",
    "POSSIBLE DRIVERS",
    "RECOMMENDED ANALYTICAL FOLLOW-UPS",
    "STORYLINE",
  ];

  const normalizeLine = (line) =>
    String(line ?? "")
      .replace(/\r/g, "")
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*\*\*(.*?)\*\*\s*:?\s*$/, "$1")
      .trim();

  const isHeading = (line) => {
    const normalized = normalizeLine(line)
      .replace(/:$/, "")
      .trim()
      .toUpperCase();

    return sectionNames.includes(normalized);
  };

  const cleanInlineMarkdown = (value) =>
    String(value ?? "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .trim();

  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/```(?:markdown|md|text)?/gi, "")
    .replace(/```/g, "")
    .split("\n")
    .map((line) => line.trim());

  const sections = [];
  let current = null;
  let preamble = [];

  lines.forEach((rawLine) => {
    const line = normalizeLine(rawLine);

    if (!line) return;

    if (isHeading(line)) {
      const title = cleanInlineMarkdown(line)
        .replace(/:$/, "")
        .trim()
        .toUpperCase();

      if (current && current.content.length) {
        sections.push(current);
      }

      current = {
        title,
        content: [],
      };
      return;
    }

    if (!current) {
      preamble.push(line);
      return;
    }

    current.content.push(line);
  });

  if (current && current.content.length) {
    sections.push(current);
  }

  if (!sections.length && preamble.length) {
    sections.push({
      title: "INSIGHTS",
      content: preamble,
    });
  } else if (preamble.length) {
    sections.unshift({
      title: "SUMMARY",
      content: preamble,
    });
  }

  const renderLine = (line, index) => {
    // Remove empty markdown bullets and placeholder bullets such as
    // "-", "--", "—", "*", "•", or numbered bullets with no actual content.
    const bulletMatch = line.match(
      /^(?:[-*•]|\d+[.)])\s*(.*)$/
    );

    const value = bulletMatch
      ? bulletMatch[1].trim()
      : line.trim();

    // Ignore empty / placeholder content.
    const isPlaceholder =
      !value ||
      /^[-–—_*•]+$/.test(value);

    if (isPlaceholder) return null;

    const boldMatch = value.match(/^\*\*(.*?)\*\*\s*(.*)$/);
    const cleanedValue = cleanInlineMarkdown(value);

    if (!cleanedValue || /^[-–—_*•]+$/.test(cleanedValue)) {
      return null;
    }

    if (bulletMatch) {
      return (
        <div className="ai-result-bullet" key={index}>
          <span className="ai-bullet-dot">•</span>
          <div className="ai-result-bullet-text">
            {boldMatch ? (
              <>
                <strong>{cleanInlineMarkdown(boldMatch[1])}</strong>
                {boldMatch[2] ? ` ${cleanInlineMarkdown(boldMatch[2])}` : ""}
              </>
            ) : (
              cleanedValue
            )}
          </div>
        </div>
      );
    }

    return (
      <p key={index}>
        {boldMatch ? (
          <>
            <strong>{cleanInlineMarkdown(boldMatch[1])}</strong>
            {boldMatch[2] ? ` ${cleanInlineMarkdown(boldMatch[2])}` : ""}
          </>
        ) : (
          cleanedValue
        )}
      </p>
    );
  };

  return (
    <div className="ai-result-sections">
      {sections.map((section, index) => {
        const content = section.content
          .map((line) => line.trim())
          .filter((line) => {
            if (!line) return false;

            const bulletMatch = line.match(
              /^(?:[-*•]|\d+[.)])\s*(.*)$/
            );

            const value = bulletMatch
              ? bulletMatch[1].trim()
              : line.trim();

            // Remove empty and placeholder bullets such as:
            // -, --, —, *, •
            if (!value) return false;
            if (/^[-–—_*•]+$/.test(value)) return false;

            return true;
          });

        if (!content.length) return null;

        return (
          <div className="ai-result-card" key={`${section.title}-${index}`}>
            <div className="ai-result-title">{section.title}</div>
            <div className="ai-result-content">
              {content.map(renderLine)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MixTooltipSegment({ className, width, label, approvalRateByAmount, approvalRateByCount }) {
  const [hover, setHover] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  return (
    <div
      className={className}
      style={{ width }}
      onMouseEnter={(e) => {
        setHover(true);
        setPosition({ x: e.clientX, y: e.clientY });
      }}
      onMouseMove={(e) => setPosition({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHover(false)}
    >
      {hover && (
        <div
          style={{
            position: "fixed",
            left: position.x + 12,
            top: position.y + 12,
            zIndex: 9999,
            background: "#ffffff",
            border: "1px solid #e3eaf2",
            borderRadius: "8px",
            padding: "10px 12px",
            boxShadow: "0 4px 14px rgba(24, 38, 56, 0.10)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              marginBottom: "6px",
              color: "#182638",
            }}
          >
            {label}
          </div>
          <div style={{ color: "#718096" }}>
            Approval Rate by Amount: {Number(approvalRateByAmount || 0).toFixed(1)}%
          </div>
          <div style={{ color: "#718096" }}>
            Approval Rate by Count: {Number(approvalRateByCount || 0).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [authenticationRows, setAuthenticationRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authenticationLoading, setAuthenticationLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [authenticationLoadError, setAuthenticationLoadError] = useState("");
  const [section, setSection] = useState("overview");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [authFilters, setAuthFilters] = useState({
    yearmonth: [],
    issuer_name: [],
    issuer_country: [],
    acquirer_name: [],
    BIN: [],
  });
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0]);
  const [aiMode, setAiMode] = useState("current_section");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiPromptResult, setAiPromptResult] = useState("");
  const [aiPromptQuestion, setAiPromptQuestion] = useState("");
  const [aiController, setAiController] = useState(null);
  const [userPrompt, setUserPrompt] = useState("");

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
        setLoadError(err?.message || "Unable to load authorization data.");
        setLoading(false);
      },
    });

    Papa.parse(AUTHENTICATION_DATA_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setAuthenticationRows((results.data || []).map(normalizeRow));
        setAuthenticationLoading(false);
      },
      error: (err) => {
        setAuthenticationLoadError(
          err?.message || "Unable to load authentication data."
        );
        setAuthenticationLoading(false);
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


  const authenticationOptions = useMemo(() => {
    const out = {};
    ["yearmonth", "issuer_name", "issuer_country", "acquirer_name", "BIN"].forEach(
      (key) => {
        out[key] = [
          ...new Set(
            authenticationRows.map((r) => r[key]).filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
          ),
        ].sort((a, b) =>
          String(a).localeCompare(String(b), undefined, { numeric: true })
        );
      }
    );
    return out;
  }, [authenticationRows]);

  const authenticationFilteredRows = useMemo(
    () =>
      authenticationRows.filter((r) =>
        ["yearmonth", "issuer_name", "issuer_country", "acquirer_name", "BIN"].every(
          (key) => {
            const selected = authFilters[key] || [];
            return (
              selected.length === 0 || selected.includes(String(r[key]))
            );
          }
        )
      ),
    [authenticationRows, authFilters]
  );

  const authenticationKpi = useMemo(
    () => authenticationMetrics(authenticationFilteredRows),
    [authenticationFilteredRows]
  );

  const authenticationTrend = useMemo(
    () => authenticationMonthly(authenticationFilteredRows),
    [authenticationFilteredRows]
  );

  const authenticationModeMix = useMemo(
    () => authenticationMix(authenticationFilteredRows),
    [authenticationFilteredRows]
  );

  const authenticationFailures = useMemo(
    () => topAuthenticationFailures(authenticationFilteredRows, 5),
    [authenticationFilteredRows]
  );

  const authenticationMandates = useMemo(
    () => topAuthenticationMandates(authenticationFilteredRows, 5),
    [authenticationFilteredRows]
  );

  const authenticationMerchants = useMemo(
    () => topAuthenticationDimension(authenticationFilteredRows, "merchant_name", 10),
    [authenticationFilteredRows]
  );

  const authenticationMCCs = useMemo(
    () => topAuthenticationDimension(authenticationFilteredRows, "MCC", 10),
    [authenticationFilteredRows]
  );

  const kpi = useMemo(() => aggregate(filteredRows), [filteredRows]);
  const trend = useMemo(() => monthly(filteredRows), [filteredRows]);

  const overviewMetrics = useMemo(() => {
    const totalAmount = kpi.approvedAmt + kpi.declinedAmt;
    return {
      totalAmount,
      approvalRateByAmount: pct(kpi.approvedAmt, totalAmount),
      approvalRateByCount: kpi.approvalRate,
      fraudRateBps: kpi.fraudRate * 100,
      chargebackRateBps: kpi.cbRate * 100,
    };
  }, [kpi]);

  const channelMix = useMemo(
    () =>
      groupBy(filteredRows, "channel").map((x) => {
        const channelRows = filteredRows.filter(
          (r) => (r.channel || "Unknown") === x.name
        );

        const approved = channelRows.reduce(
          (s, r) => s + n(r["approved count"]),
          0
        );
        const declined = channelRows.reduce(
          (s, r) => s + n(r["decline count"]),
          0
        );
        const approvedAmt = channelRows.reduce(
          (s, r) => s + n(r["approved amt"]),
          0
        );
        const declinedAmt = channelRows.reduce(
          (s, r) => s + n(r["decline amount"]),
          0
        );

        return {
          ...x,
          approved,
          approvalRateByCount: pct(approved, approved + declined),
          approvalRateByAmount: pct(
            approvedAmt,
            approvedAmt + declinedAmt
          ),
        };
      }),
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

const threeDSApprovalRateByCount = useMemo(
  () => primaryCategoryApprovalRate(performance3DS, /3ds/i),
  [performance3DS]
);

const tokenizedApprovalRateByCount = useMemo(
  () => primaryCategoryApprovalRate(performanceTokenization, /token/i),
  [performanceTokenization]
);

const topMerchants = useMemo(
  () => topAmountApproval(filteredRows, "merchant_name"),
  [filteredRows]
);

const topMCCs = useMemo(
  () => topAmountApproval(filteredRows, "mcc"),
  [filteredRows]
);  
  
const ticketDeclineData = useMemo(
  () => ticketDeclineMix(filteredRows),
  [filteredRows]
);

  const declineMonthlyData = useMemo(
  () => declineMonthlyTrend(filteredRows),
  [filteredRows]
);

const declineMonthMixData = useMemo(
  () => declineReasonMixByDimension(filteredRows, "year_month"),
  [filteredRows]
);

const declineMerchantMixData = useMemo(
  () => declineReasonMixByDimension(filteredRows, "merchant_name", 10),
  [filteredRows]
);

const declineMCCMixData = useMemo(
  () => declineReasonMixByDimension(filteredRows, "mcc", 10),
  [filteredRows]
);

const topDeclineMerchants = useMemo(
  () => topDeclineAmountByDimension(filteredRows, "merchant_name", 10),
  [filteredRows]
);

const topDeclineMCCs = useMemo(
  () => topDeclineAmountByDimension(filteredRows, "mcc", 10),
  [filteredRows]
);
const fraudMonthlyData = useMemo(
  () => fraudMonthlyTrend(filteredRows),
  [filteredRows]
);

const chargebackMonthlyData = useMemo(
  () => chargebackMonthlyTrend(filteredRows),
  [filteredRows]
);

const chargebackLifecycleData = useMemo(
  () => chargebackLifecycleMix(filteredRows),
  [filteredRows]
);  
  const aiContext = useMemo(() => {
    const authorizationFilters = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => Array.isArray(value) && value.length > 0)
    );
    const authenticationFilters = Object.fromEntries(
      Object.entries(authFilters).filter(([, value]) => Array.isArray(value) && value.length > 0)
    );

    const buildMix = (definitions) => Object.fromEntries(
      Object.entries(definitions).map(([name, dimensionRows]) => {
        const totalCount = dimensionRows.reduce((sum, r) => sum + n(r["approved count"]) + n(r["decline count"]), 0);
        const approvedCount = dimensionRows.reduce((sum, r) => sum + n(r["approved count"]), 0);
        const approvedAmount = dimensionRows.reduce((sum, r) => sum + n(r["approved amt"]), 0);
        const totalAmount = dimensionRows.reduce((sum, r) => sum + n(r["approved amt"]) + n(r["decline amount"]), 0);
        return [name, {
          transactionCount: totalCount,
          share: pct(totalCount, kpi.total),
          approvalRateByCount: pct(approvedCount, totalCount),
          approvalRateByAmount: pct(approvedAmount, totalAmount),
        }];
      })
    );

    const cardNetworkMix = buildMix({
      Visa: filteredRows.filter((r) => String(r.bin || "").startsWith("4")),
      Mastercard: filteredRows.filter((r) => String(r.bin || "").startsWith("5")),
    });
    const productMix = buildMix({
      Credit: filteredRows.filter((r) => String(r["prod type"]).toLowerCase().includes("credit")),
      Debit: filteredRows.filter((r) => String(r["prod type"]).toLowerCase().includes("debit")),
      Prepaid: filteredRows.filter((r) => String(r["prod type"]).toLowerCase().includes("prepaid")),
    });

    const sectionContexts = {
      overview: {
        kpis: {
          totalAmount: overviewMetrics.totalAmount,
          totalTransactions: kpi.total,
          approvalRateByAmount: overviewMetrics.approvalRateByAmount,
          approvalRateByCount: overviewMetrics.approvalRateByCount,
          fraudRateBps: overviewMetrics.fraudRateBps,
          chargebackRateBps: overviewMetrics.chargebackRateBps,
        },
        visualizations: ["Authorization trend", "Approved volume by channel", "Top decline drivers", "Card network mix", "Product type mix"],
        monthlyAuthorizationTrend: trend,
        channelPerformance: channelMix,
        cardNetworkMix,
        productMix,
        topDeclineDrivers: declineReasons,
        fraudDrivers: fraudReasons,
        chargebackDrivers: cbReasons,
      },
      performance: {
        kpis: {
          authorizationVolume: kpi.total,
          approvalRate: kpi.approvalRate,
          approvedValue: kpi.approvedAmt,
          declineRate: kpi.declineRate,
          threeDSApprovalRateByCount: threeDSApprovalRateByCount,
          tokenizedApprovalRateByCount: tokenizedApprovalRateByCount,
        },
        visualizations: ["Approval rate by acquirer", "3DS performance", "Tokenization performance", "Entry mode performance", "Wallet performance", "Top 10 merchants by transaction amount with approval rate", "Top 10 MCCs by transaction amount with approval rate"],
        acquirerApprovalTrend: acquirerTrend,
        authenticationDimensions: { threeDS: performance3DS, tokenization: performanceTokenization, entryMode: performanceEntryMode, wallet: performanceWallet },
        topMerchantsByAmount: topMerchants,
        topMCCsByAmount: topMCCs,
      },
      decline: {
        kpis: {
          authorizationVolume: kpi.total,
          approvalRate: kpi.approvalRate,
          approvedValue: kpi.approvedAmt,
          declinedTransactions: kpi.declined,
          declinedValue: kpi.declinedAmt,
          declineRate: kpi.declineRate,
        },
        visualizations: ["Decline reason distribution", "Monthly decline trend", "Decline reason mix by ticket size", "Decline reason mix by month", "Top merchants by decline amount", "Top MCCs by decline amount", "Decline reason mix by merchant", "Decline reason mix by MCC"],
        declineReasonDistribution: declineReasons,
        monthlyDeclineTrend: declineMonthlyData,
        declineReasonMixByTicketSize: ticketDeclineData,
        declineReasonMixByMonth: declineMonthMixData,
        topMerchantsByDeclineAmount: topDeclineMerchants,
        topMCCsByDeclineAmount: topDeclineMCCs,
        declineReasonMixByMerchant: declineMerchantMixData,
        declineReasonMixByMCC: declineMCCMixData,
      },
      risk: {
        fraud: { transactions: kpi.fraud, rate: kpi.fraudRate, amount: kpi.fraudAmt, topReasons: fraudReasons, monthlyTrend: fraudMonthlyData },
        chargebacks: { transactions: kpi.cb, rate: kpi.cbRate, amount: kpi.cbAmt, topReasons: cbReasons, monthlyTrend: chargebackMonthlyData, lifecycle: chargebackLifecycleData },
        visualizations: ["Fraud monthly trend", "Chargeback monthly trend", "Chargeback lifecycle", "Top fraud drivers", "Top chargeback drivers"],
      },
      authentication: {
        filters: authenticationFilters,
        rowsInScope: authenticationFilteredRows.length,
        kpis: {
          totalAuthenticationTransactions: authenticationKpi.total,
          successCount: authenticationKpi.success,
          successRate: authenticationKpi.successRate,
          challengeSuccessRate: authenticationKpi.challengeSuccessRate,
          frictionlessSuccessRate: authenticationKpi.frictionlessSuccessRate,
        },
        visualizations: ["MoM authenticated volumes with success rate", "Challenge vs Frictionless", "Top 5 authentication failure reasons", "Top 5 challenge mandates", "Top 10 merchants with authentication count and success rate", "Top 10 MCCs with authentication count and success rate"],
        monthlyTrend: authenticationTrend,
        challengeVsFrictionless: authenticationModeMix,
        failureReasons: authenticationFailures,
        challengeMandates: authenticationMandates,
        topMerchants: authenticationMerchants,
        topMCCs: authenticationMCCs,
      },
    };
    const currentSectionContext = sectionContexts[section] || sectionContexts.overview;
    return {
      analysisMode: aiMode,
      view: SECTIONS.find(([id]) => id === section)?.[1] || section,
      currentSection: section,
      currentSectionContext,
      dashboardSummary: {
        overview: sectionContexts.overview,
        authorizationPerformance: sectionContexts.performance,
        declineAnalysis: sectionContexts.decline,
        fraudAndChargebacks: sectionContexts.risk,
        authentication: sectionContexts.authentication,
      },
      filters: { authorization: authorizationFilters, authentication: authenticationFilters },
      scope: { authorizationRows: filteredRows.length, authenticationRows: authenticationFilteredRows.length },
      metricDefinitions: {
        approvalRateByCount: "Approved authorization transactions / total authorization transactions",
        approvalRateByAmount: "Approved authorization amount / total authorization amount",
        fraudRate: "Fraud transactions / approved authorization transactions",
        chargebackRate: "Chargeback transactions / approved authorization transactions",
        authenticationSuccessRate: "Authenticated authentication transactions / total authentication transactions",
      },
      analysisGuidance: {
        useOnlyProvidedMetrics: true,
        prioritizeVisibleVisualizations: true,
        compareAmountAndCountRates: true,
        identifyConcentration: true,
        identifyTrendChanges: true,
        identifyMixShifts: true,
        distinguishVolumeFromRate: true,
        avoidUnsupportedCausality: true,
      },
    };
  }, [
    aiMode, section, filters, authFilters, filteredRows, authenticationFilteredRows,
    authenticationKpi, authenticationTrend, authenticationModeMix, authenticationFailures,
    authenticationMandates, authenticationMerchants, authenticationMCCs, kpi, overviewMetrics,
    trend, channelMix, declineReasons, fraudReasons, cbReasons, acquirerTrend, performance3DS,
    performanceTokenization, performanceEntryMode, performanceWallet, threeDSApprovalRateByCount,
    tokenizedApprovalRateByCount, topMerchants, topMCCs, ticketDeclineData, declineMonthlyData,
    declineMonthMixData, declineMerchantMixData, declineMCCMixData, topDeclineMerchants,
    topDeclineMCCs, fraudMonthlyData, chargebackMonthlyData, chargebackLifecycleData,
  ]);


  async function generateInsights(mode = aiMode, promptOverride = null) {
    const isPromptRequest = promptOverride !== null;
    const promptText = isPromptRequest
      ? String(promptOverride || "").trim()
      : "";

    setAiLoading(true);
    setAiStatus(isPromptRequest ? "Answering your question…" : "Generating insights…");

    // Prompt responses are separate from the dashboard analysis.
    // Never clear the dashboard analysis when a user asks a question.
    if (isPromptRequest) {
      setAiPromptQuestion(promptText);
    }

    const controller = new AbortController();
    setAiController(controller);
    try {
      const response = await fetch(AI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          model: selectedModel.model,
          dashboardData: {
            ...aiContext,
            analysisMode: mode,
          },
          analysisMode: mode,
          userPrompt:
            promptOverride !== null
              ? promptOverride
              : userPrompt.trim(),
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "AI request failed.");
      }
      const generatedText = payload.insights || "No insights were returned.";

      if (isPromptRequest) {
        setAiPromptResult(generatedText);
        setAiStatus("Answer generated");
      } else {
        setAiResult(generatedText);
        setAiStatus("Insights generated");
      }
    } catch (err) {
      if (err?.name === "AbortError") setAiStatus("Generation stopped");
      else {
        setAiStatus("Generation failed");
        const errorText = `Unable to generate insights: ${err?.message || "Unknown error"}`;
        if (isPromptRequest) {
          setAiPromptResult(errorText);
        } else {
          setAiResult(errorText);
        }
      }
    } finally {
      setAiLoading(false);
      setAiController(null);
    }
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  if (loading || authenticationLoading) {
    return (
      <div className="app loading-screen">
        <div className="loader-orb" />
        <div>
          <div className="eyebrow">PAYMENTS INTELLIGENCE</div>
          <h1>Loading dashboard data</h1>
          <p>Connecting to the authorization and authentication data sources…</p>
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
          <p className="muted">Check that the authorization data source is available and try refreshing.</p>
        </div>
      </div>
    );
  }

  if (authenticationLoadError) {
    return (
      <div className="app loading-screen">
        <div>
          <div className="eyebrow">AUTHENTICATION DATA ERROR</div>
          <h1>Unable to load authentication data</h1>
          <p>{authenticationLoadError}</p>
          <p className="muted">Check that the authentication CSV is available and try refreshing.</p>
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

        <div className="side-label">AUTHORIZATION FILTERS</div>
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
            <h1>Authentication-Authorization Intelligence</h1>
          </div>
          <div className="top-actions">
            <div className="scope-pill">
              <span>{number(section === "authentication" ? authenticationFilteredRows.length : filteredRows.length)}</span> rows in scope
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
            <span>{section === "authentication" ? "Filtered authentication activity" : "Filtered authorization activity"}</span>
          </div>

          {section === "authentication" ? null : section === "overview" ? (
            <div className="kpi-grid">
              <Kpi label="Total Amount" value={money(overviewMetrics.totalAmount)} sub="approved + declined amount" />
              <Kpi label="Total Count" value={number(kpi.total)} sub="approved + declined transactions" />
              <Kpi label="Approval Rate by Amount" value={rate(overviewMetrics.approvalRateByAmount)} sub="approved amount / total amount" />
              <Kpi label="Approval Rate by Count" value={rate(overviewMetrics.approvalRateByCount)} sub="approved count / total count" />
              <Kpi label="Fraud Rate (BPS)" value={bps(overviewMetrics.fraudRateBps)} sub={`${number(kpi.fraud)} fraud transactions`} />
              <Kpi label="Chargeback Rate (BPS)" value={bps(overviewMetrics.chargebackRateBps)} sub={`${number(kpi.cb)} chargebacks`} />
            </div>
          ) : section === "performance" ? (
            <div className="kpi-grid">
              <Kpi label="Authorization Volume" value={number(kpi.total)} sub="approved + declined" />
              <Kpi label="Approval Rate" value={rate(kpi.approvalRate)} sub={`${number(kpi.approved)} approved`} />
              <Kpi label="Approved Value" value={money(kpi.approvedAmt)} sub="approved transaction value" />
              <Kpi label="Decline Rate" value={rate(kpi.declineRate)} sub={`${number(kpi.declined)} declined`} />
              <Kpi label="3DS Approval Rate by Count" value={rate(threeDSApprovalRateByCount)} sub="3DS transactions" />
              <Kpi label="Tokenized Approval Rate by Count" value={rate(tokenizedApprovalRateByCount)} sub="tokenized transactions" />
            </div>
) : section === "decline" ? (
            <div className="kpi-grid">
              <Kpi label="Authorization Volume" value={number(kpi.total)} sub="approved + declined" />
              <Kpi label="Approval Rate" value={rate(kpi.approvalRate)} sub={`${number(kpi.approved)} approved`} />
              <Kpi label="Approved Value" value={money(kpi.approvedAmt)} sub="approved transaction value" />
              <Kpi label="Declined Transactions" value={number(kpi.declined)} sub="transactions" />
              <Kpi label="Declined Value" value={money(kpi.declinedAmt)} sub="declined amount" />
              <Kpi label="Decline Rate" value={rate(kpi.declineRate)} sub="of authorization volume" />
            </div>
          ) : (
            <div className="kpi-grid">
              <Kpi label="Authorization Volume" value={number(kpi.total)} sub="approved + declined" />
              <Kpi label="Approval Rate" value={rate(kpi.approvalRate)} sub={`${number(kpi.approved)} approved`} />
              <Kpi label="Approved Value" value={money(kpi.approvedAmt)} sub="approved transaction value" />
              <Kpi label="Decline Rate" value={rate(kpi.declineRate)} sub={`${number(kpi.declined)} declined`} />
              <Kpi label="Fraud Rate" value={bps(kpi.fraudRate * 100)} sub={`${number(kpi.fraud)} fraud transactions`} />
              <Kpi label="Chargeback Rate" value={bps(kpi.cbRate * 100)} sub={`${number(kpi.cb)} chargebacks`} />
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
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;

                            const data = payload[0]?.payload;
                            if (!data) return null;

                            return (
                              <div
                                style={{
                                  background: "#ffffff",
                                  border: "1px solid #e3eaf2",
                                  borderRadius: "8px",
                                  padding: "10px 12px",
                                  boxShadow: "0 4px 14px rgba(24, 38, 56, 0.10)",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 600,
                                    marginBottom: "6px",
                                    color: "#182638",
                                  }}
                                >
                                  {data.name}
                                </div>
                                <div style={{ color: "#718096" }}>
                                  Approved Volume: {number(data.approved)}
                                </div>
                                <div style={{ color: "#718096" }}>
                                  Approval Rate by Amount:{" "}
                                  {Number(data.approvalRateByAmount || 0).toFixed(1)}%
                                </div>
                                <div style={{ color: "#718096" }}>
                                  Approval Rate by Count:{" "}
                                  {Number(data.approvalRateByCount || 0).toFixed(1)}%
                                </div>
                              </div>
                            );
                          }}
                        />
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

                        {(() => {
                          const visaRows = filteredRows.filter((r) =>
                            String(r.bin || "").startsWith("4")
                          );
                          const mastercardRows = filteredRows.filter((r) =>
                            String(r.bin || "").startsWith("5")
                          );

                          const visa = visaRows.reduce(
                            (s, r) => s + n(r["approved count"]) + n(r["decline count"]),
                            0
                          );
                          const mastercard = mastercardRows.reduce(
                            (s, r) => s + n(r["approved count"]) + n(r["decline count"]),
                            0
                          );

                          const visaApproved = visaRows.reduce(
                            (s, r) => s + n(r["approved count"]),
                            0
                          );
                          const mastercardApproved = mastercardRows.reduce(
                            (s, r) => s + n(r["approved count"]),
                            0
                          );

                          const visaApprovedAmt = visaRows.reduce(
                            (s, r) => s + n(r["approved amt"]),
                            0
                          );
                          const mastercardApprovedAmt = mastercardRows.reduce(
                            (s, r) => s + n(r["approved amt"]),
                            0
                          );

                          const visaTotalAmt = visaRows.reduce(
                            (s, r) => s + n(r["approved amt"]) + n(r["decline amount"]),
                            0
                          );
                          const mastercardTotalAmt = mastercardRows.reduce(
                            (s, r) => s + n(r["approved amt"]) + n(r["decline amount"]),
                            0
                          );

                          const total = visa + mastercard;

                          return (
                            <>
                              <div className="mix-bar">
                                <MixTooltipSegment
                                  className="mix-segment visa"
                                  width={`${pct(visa, total)}%`}
                                  label="Visa"
                                  approvalRateByAmount={pct(visaApprovedAmt, visaTotalAmt)}
                                  approvalRateByCount={pct(visaApproved, visa)}
                                />
                                <MixTooltipSegment
                                  className="mix-segment mastercard"
                                  width={`${pct(mastercard, total)}%`}
                                  label="Mastercard"
                                  approvalRateByAmount={pct(
                                    mastercardApprovedAmt,
                                    mastercardTotalAmt
                                  )}
                                  approvalRateByCount={pct(mastercardApproved, mastercard)}
                                />
                              </div>

                              <div className="mix-legend">
                                <span>
                                  <i className="mix-dot visa-dot" /> Visa{" "}
                                  <strong>{pct(visa, total).toFixed(1)}%</strong>
                                </span>
                                <span>
                                  <i className="mix-dot mastercard-dot" /> Mastercard{" "}
                                  <strong>{pct(mastercard, total).toFixed(1)}%</strong>
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="mix-section">
                        <div className="mix-header">
                          <span>Product Type</span>
                        </div>

                        {(() => {
                          const productRows = {
                            Credit: filteredRows.filter((r) =>
                              String(r["prod type"]).toLowerCase().includes("credit")
                            ),
                            Debit: filteredRows.filter((r) =>
                              String(r["prod type"]).toLowerCase().includes("debit")
                            ),
                            Prepaid: filteredRows.filter((r) =>
                              String(r["prod type"]).toLowerCase().includes("prepaid")
                            ),
                          };

                          const metrics = Object.fromEntries(
                            Object.entries(productRows).map(([name, rows]) => {
                              const totalCount = rows.reduce(
                                (s, r) =>
                                  s + n(r["approved count"]) + n(r["decline count"]),
                                0
                              );
                              const approvedCount = rows.reduce(
                                (s, r) => s + n(r["approved count"]),
                                0
                              );
                              const approvedAmt = rows.reduce(
                                (s, r) => s + n(r["approved amt"]),
                                0
                              );
                              const totalAmt = rows.reduce(
                                (s, r) =>
                                  s + n(r["approved amt"]) + n(r["decline amount"]),
                                0
                              );

                              return [
                                name,
                                {
                                  totalCount,
                                  approvalRateByCount: pct(approvedCount, totalCount),
                                  approvalRateByAmount: pct(approvedAmt, totalAmt),
                                },
                              ];
                            })
                          );

                          const total =
                            metrics.Credit.totalCount +
                            metrics.Debit.totalCount +
                            metrics.Prepaid.totalCount;

                          return (
                            <>
                              <div className="mix-bar">
                                <MixTooltipSegment
                                  className="mix-segment credit"
                                  width={`${pct(metrics.Credit.totalCount, total)}%`}
                                  label="Credit"
                                  approvalRateByAmount={metrics.Credit.approvalRateByAmount}
                                  approvalRateByCount={metrics.Credit.approvalRateByCount}
                                />
                                <MixTooltipSegment
                                  className="mix-segment debit"
                                  width={`${pct(metrics.Debit.totalCount, total)}%`}
                                  label="Debit"
                                  approvalRateByAmount={metrics.Debit.approvalRateByAmount}
                                  approvalRateByCount={metrics.Debit.approvalRateByCount}
                                />
                                <MixTooltipSegment
                                  className="mix-segment prepaid"
                                  width={`${pct(metrics.Prepaid.totalCount, total)}%`}
                                  label="Prepaid"
                                  approvalRateByAmount={metrics.Prepaid.approvalRateByAmount}
                                  approvalRateByCount={metrics.Prepaid.approvalRateByCount}
                                />
                              </div>

                              <div className="mix-legend">
                                <span>
                                  <i className="mix-dot credit-dot" /> Credit{" "}
                                  <strong>
                                    {pct(metrics.Credit.totalCount, total).toFixed(1)}%
                                  </strong>
                                </span>
                                <span>
                                  <i className="mix-dot debit-dot" /> Debit{" "}
                                  <strong>
                                    {pct(metrics.Debit.totalCount, total).toFixed(1)}%
                                  </strong>
                                </span>
                                <span>
                                  <i className="mix-dot prepaid-dot" /> Prepaid{" "}
                                  <strong>
                                    {pct(metrics.Prepaid.totalCount, total).toFixed(1)}%
                                  </strong>
                                </span>
                              </div>
                            </>
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
                    title="Top 10 Merchants by Transaction Amount"
                    subtitle="Total transaction amount with approval rate by count"
                  >
                    <ResponsiveContainer width="100%" height={380}>
                      <ComposedChart
                        data={topMerchants}
                        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 10 }}
                          angle={-30}
                          textAnchor="end"
                          interval={0}
                        />
                
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={money}
                        />
                
                        <Tooltip
                          formatter={(value, name, props) => {
                            if (name === "Approval Rate") {
                              return [
                                `${Number(props?.payload?.approvalRate ?? 0).toFixed(2)}%`,
                                name,
                              ];
                            }
                
                            return [
                              money(value),
                              "Total Amount",
                            ];
                          }}
                        />
                
                
                        <Bar
                          dataKey="totalAmount"
                          name="Total Amount"
                          fill="#46b5ff"
                          radius={[6, 6, 0, 0]}
                        />
                
                        <Line
                          type="monotone"
                          dataKey="approvalRateVisual"
                          name="Approval Rate"
                          stroke="#ff6b87"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>



                <div style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="Top 10 MCCs by Transaction Amount"
                    subtitle="Total transaction amount with approval rate by count"
                  >
                    <ResponsiveContainer width="100%" height={380}>
                      <ComposedChart
                        data={topMCCs}
                        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 10 }}
                          angle={-30}
                          textAnchor="end"
                          interval={0}
                        />
                
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={money}
                        />
                
                        <Tooltip
                          formatter={(value, name, props) => {
                            if (name === "Approval Rate") {
                              return [
                                `${Number(props?.payload?.approvalRate ?? 0).toFixed(2)}%`,
                                name,
                              ];
                            }
                
                            return [
                              money(value),
                              "Total Amount",
                            ];
                          }}
                        />
                
                
                        <Bar
                          dataKey="totalAmount"
                          name="Total Amount"
                          fill="#46b5ff"
                          radius={[6, 6, 0, 0]}
                        />
                
                        <Line
                          type="monotone"
                          dataKey="approvalRateVisual"
                          name="Approval Rate"
                          stroke="#ff6b87"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
            
              </motion.div>
            )}

           {section === "decline" && (
              <motion.div
                key="decline"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >

                {/* ROW 1 — DECLINE REASONS + MONTHLY DECLINE TREND */}
                <div className="chart-grid two">
                  <ChartCard
                    title="Decline Reason Distribution"
                    subtitle="Top response descriptions by count and % share"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {declineReasons.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                            }}
                          >
                            {x.name}
                          </span>
            
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "12px",
                                color: "#182638",
                              }}
                            >
                              {number(x.value)}
                            </strong>
            
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {pct(x.value, kpi.declined).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
            
                  <ChartCard
                    title="Monthly Decline Trend"
                    subtitle="Decline amount with decline rate"
                  >
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart
                        data={declineMonthlyData}
                        margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11 }}
                        />
                    
                        <YAxis
                          domain={["dataMin", "dataMax"]}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => money(value)}
                        />
                    
                        <Tooltip
                          formatter={(value, name, props) => {
                            if (name === "Decline Rate") {
                              return [`${Number(props.payload.declineRate).toFixed(1)}%`, name];
                            }
                    
                            return [money(value), "Decline Amount"];
                          }}
                        />
                    
                        <Bar
                          dataKey="declineAmount"
                          name="Decline Amount"
                          fill="#46b5ff"
                          radius={[6, 6, 0, 0]}
                        />
                    
                        <Line
                          type="monotone"
                          dataKey="declineRateVisual"
                          name="Decline Rate"
                          stroke="#ff6b87"
                          strokeWidth={3}
                          dot={{
                            r: 5,
                            fill: "#ff6b87",
                            stroke: "#ffffff",
                            strokeWidth: 2,
                          }}
                          activeDot={{ r: 6 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>

                
            
                {/* ROW 2 — TICKET SIZE + MONTHLY DECLINE MIX */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="Decline Reason Mix by Ticket Size"
                    subtitle="Top 4 decline reasons within each ticket size band"
                  >
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart
                        data={ticketDeclineData}
                        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                        barCategoryGap="35%"
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
            
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
            
                            return [
                              `${Number(value).toFixed(1)}%`,
                              reasonName,
                            ];
                          }}
                        />
            
                        <Bar
                          dataKey="reason_0"
                          stackId="declines"
                          fill="#46b5ff"
                        />
                        <Bar
                          dataKey="reason_1"
                          stackId="declines"
                          fill="#66d4a6"
                        />
                        <Bar
                          dataKey="reason_2"
                          stackId="declines"
                          fill="#ffb86b"
                        />
                        <Bar
                          dataKey="reason_3"
                          stackId="declines"
                          fill="#ff6b87"
                        />
                        <Bar
                          dataKey="reason_others"
                          stackId="declines"
                          fill="#8b7cf6"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
            
                  <ChartCard
                    title="Decline Reason Mix by Month"
                    subtitle="Top 4 decline reasons within each month"
                  >
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart
                        data={declineMonthMixData}
                        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                        barCategoryGap="35%"
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
            
                        <XAxis
                          dataKey="dimension"
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
            
                            return [
                              `${Number(value).toFixed(1)}%`,
                              reasonName,
                            ];
                          }}
                        />
            
                        <Bar
                          dataKey="reason_0"
                          stackId="declines"
                          fill="#46b5ff"
                        />
                        <Bar
                          dataKey="reason_1"
                          stackId="declines"
                          fill="#66d4a6"
                        />
                        <Bar
                          dataKey="reason_2"
                          stackId="declines"
                          fill="#ffb86b"
                        />
                        <Bar
                          dataKey="reason_3"
                          stackId="declines"
                          fill="#ff6b87"
                        />
                        <Bar
                          dataKey="reason_others"
                          stackId="declines"
                          fill="#8b7cf6"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>

                {/* ROW 3 — TOP MERCHANTS + MCCs BY DECLINE AMOUNT */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="Top Merchants by Decline Amount"
                    subtitle="% share of total declined amount"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {topDeclineMerchants.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={x.name}
                          >
                            {x.name}
                          </span>
                
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "12px",
                                color: "#182638",
                              }}
                            >
                              {money(x.declineAmount)}
                            </strong>
                
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {x.share.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
                
                  <ChartCard
                    title="Top MCCs by Decline Amount"
                    subtitle="% share of total declined amount"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {topDeclineMCCs.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={x.name}
                          >
                            {x.name}
                          </span>
                
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "12px",
                                color: "#182638",
                              }}
                            >
                              {money(x.declineAmount)}
                            </strong>
                
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {x.share.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
                </div>
            
                {/* ROW 3 — MERCHANT + MCC DECLINE MIX */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="Decline Reason Mix by Merchant"
                    subtitle="Top 10 merchants by declined transaction count"
                  >
                    <ResponsiveContainer width="100%" height={380}>
                      <BarChart
                        data={declineMerchantMixData}
                        margin={{ top: 10, right: 20, left: 10, bottom: 60 }}
                        barCategoryGap="35%"
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
            
                        <XAxis
                          dataKey="dimension"
                          tick={{ fontSize: 10 }}
                          angle={-30}
                          textAnchor="end"
                          interval={0}
                        />
            
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 75, 100]}
                          tickFormatter={(value) => `${value}%`}
                          tick={{ fontSize: 11 }}
                        />
            
                        <Tooltip
                          formatter={(value, name, props) => {
                            const reasonName =
                              props?.payload?.[`${name}_name`] || name;
            
                            return [
                              `${Number(value).toFixed(1)}%`,
                              reasonName,
                            ];
                          }}
                        />
            
                        <Bar
                          dataKey="reason_0"
                          stackId="declines"
                          fill="#46b5ff"
                        />
                        <Bar
                          dataKey="reason_1"
                          stackId="declines"
                          fill="#66d4a6"
                        />
                        <Bar
                          dataKey="reason_2"
                          stackId="declines"
                          fill="#ffb86b"
                        />
                        <Bar
                          dataKey="reason_3"
                          stackId="declines"
                          fill="#ff6b87"
                        />
                        <Bar
                          dataKey="reason_others"
                          stackId="declines"
                          fill="#8b7cf6"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
            
                  <ChartCard
                    title="Decline Reason Mix by MCC"
                    subtitle="Top 10 MCCs by declined transaction count"
                  >
                    <ResponsiveContainer width="100%" height={380}>
                      <BarChart
                        data={declineMCCMixData}
                        margin={{ top: 10, right: 20, left: 10, bottom: 60 }}
                        barCategoryGap="35%"
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
            
                        <XAxis
                          dataKey="dimension"
                          tick={{ fontSize: 10 }}
                          angle={-30}
                          textAnchor="end"
                          interval={0}
                        />
            
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 75, 100]}
                          tickFormatter={(value) => `${value}%`}
                          tick={{ fontSize: 11 }}
                        />
            
                        <Tooltip
                          formatter={(value, name, props) => {
                            const reasonName =
                              props?.payload?.[`${name}_name`] || name;
            
                            return [
                              `${Number(value).toFixed(1)}%`,
                              reasonName,
                            ];
                          }}
                        />
            
                        <Bar
                          dataKey="reason_0"
                          stackId="declines"
                          fill="#46b5ff"
                        />
                        <Bar
                          dataKey="reason_1"
                          stackId="declines"
                          fill="#66d4a6"
                        />
                        <Bar
                          dataKey="reason_2"
                          stackId="declines"
                          fill="#ffb86b"
                        />
                        <Bar
                          dataKey="reason_3"
                          stackId="declines"
                          fill="#ff6b87"
                        />
                        <Bar
                          dataKey="reason_others"
                          stackId="declines"
                          fill="#8b7cf6"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
              </motion.div>
            )}

            {section === "risk" && (
              <motion.div
                key="risk"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {/* KPI CARDS — unchanged */}
                <div className="kpi-grid compact">
                  <Kpi
                    label="Fraud Transactions"
                    value={number(kpi.fraud)}
                    sub={`${bps(kpi.fraudRate * 100)} of approved`}
                  />
                  <Kpi
                    label="Fraud Exposure"
                    value={money(kpi.fraudAmt)}
                    sub="fraud amount"
                  />
                  <Kpi
                    label="Chargebacks"
                    value={number(kpi.cb)}
                    sub={`${bps(kpi.cbRate * 100)} of approved`}
                  />
                  <Kpi
                    label="Chargeback Exposure"
                    value={money(kpi.cbAmt)}
                    sub="chargeback total"
                  />
                </div>
            
                {/* ROW 1 — FRAUD REASONS + CHARGEBACK REASONS + LIFECYCLE PIE */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "14px",
                    marginTop: "16px",
                  }}
                >
                  {/* FRAUD REASON DISTRIBUTION */}
                  <ChartCard
                    title="Fraud Reason Distribution"
                    subtitle="Top fraud reasons by count and % share"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {fraudReasons.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                            }}
                          >
                            {x.name}
                          </span>
            
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "12px",
                                color: "#182638",
                              }}
                            >
                              {number(x.value)}
                            </strong>
            
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {pct(x.value, kpi.fraud).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
            
                  {/* CHARGEBACK REASON DISTRIBUTION */}
                  <ChartCard
                    title="Chargeback Reason Distribution"
                    subtitle="Top chargeback reasons by count and % share"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {cbReasons.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                            }}
                          >
                            {x.name}
                          </span>
            
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "12px",
                                color: "#182638",
                              }}
                            >
                              {number(x.value)}
                            </strong>
            
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {pct(x.value, kpi.cb).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
            
                  {/* CHARGEBACK LIFECYCLE PIE */}
                  <ChartCard
                    title="Chargeback Lifecycle Mix"
                    subtitle="% of total chargeback count"
                  >
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={chargebackLifecycleData}
                          dataKey="count"
                          nameKey="name"
                          cx="50%"
                          cy="46%"
                          outerRadius={92}
                          innerRadius={48}
                          paddingAngle={2}
                        >
                          {chargebackLifecycleData.map((entry, index) => (
                            <Cell
                              key={`lifecycle-${index}`}
                              fill={
                                ["#46b5ff", "#66d4a6", "#ffb86b"][index]
                              }
                            />
                          ))}
                        </Pie>
            
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
            
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
            
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "#718096",
                                    marginBottom: "4px",
                                  }}
                                >
                                  Chargeback Count:{" "}
                                  <strong style={{ color: "#182638" }}>
                                    {number(x.count)}
                                  </strong>
                                </div>
            
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "#718096",
                                    marginBottom: "4px",
                                  }}
                                >
                                  Count Share:{" "}
                                  <strong style={{ color: "#182638" }}>
                                    {x.share.toFixed(1)}%
                                  </strong>
                                </div>
            
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "#718096",
                                  }}
                                >
                                  Amount:{" "}
                                  <strong style={{ color: "#182638" }}>
                                    {money(x.amount)}
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
                </div>
            
                {/* ROW 2 — MONTHLY FRAUD + MONTHLY CHARGEBACK */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  {/* MONTHLY FRAUD */}
                  <ChartCard
                    title="Monthly Fraud Trend"
                    subtitle="Fraud volume with fraud rate in BPS"
                  >
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart
                        data={fraudMonthlyData}
                        margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
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
                          domain={["dataMin", "dataMax"]}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => number(value)}
                        />
            
                        <Tooltip
                          formatter={(value, name, props) => {
                            if (name === "Fraud Rate") {
                              return [
                                `${Number(
                                  props.payload.fraudRateBps
                                ).toFixed(2)} BPS`,
                                name,
                              ];
                            }
            
                            return [
                              number(value),
                              "Fraud Volume",
                            ];
                          }}
                        />
            
                        <Legend />
            
                        <Bar
                          dataKey="fraud"
                          name="Fraud Volume"
                          fill="#ffb86b"
                          radius={[6, 6, 0, 0]}
                        />
            
                        <Line
                          type="monotone"
                          dataKey="fraudRateVisual"
                          name="Fraud Rate"
                          stroke="#ff6b87"
                          strokeWidth={3}
                          dot={{
                            r: 5,
                            fill: "#ff6b87",
                            stroke: "#ffffff",
                            strokeWidth: 2,
                          }}
                          activeDot={{ r: 6 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
            
                  {/* MONTHLY CHARGEBACK */}
                  <ChartCard
                    title="Monthly Chargeback Trend"
                    subtitle="Chargeback volume with chargeback rate in BPS"
                  >
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart
                        data={chargebackMonthlyData}
                        margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
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
                          domain={["dataMin", "dataMax"]}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => number(value)}
                        />
            
                        <Tooltip
                          formatter={(value, name, props) => {
                            if (name === "Chargeback Rate") {
                              return [
                                `${Number(
                                  props.payload.chargebackRateBps
                                ).toFixed(2)} BPS`,
                                name,
                              ];
                            }
            
                            return [
                              number(value),
                              "Chargeback Volume",
                            ];
                          }}
                        />
            
                        <Legend />
            
                        <Bar
                          dataKey="chargebacks"
                          name="Chargeback Volume"
                          fill="#46b5ff"
                          radius={[6, 6, 0, 0]}
                        />
            
                        <Line
                          type="monotone"
                          dataKey="chargebackRateVisual"
                          name="Chargeback Rate"
                          stroke="#ff6b87"
                          strokeWidth={3}
                          dot={{
                            r: 5,
                            fill: "#ff6b87",
                            stroke: "#ffffff",
                            strokeWidth: 2,
                          }}
                          activeDot={{ r: 6 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
              </motion.div>
            )}

            {section === "authentication" && (
              <motion.div
                key="authentication"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div
                  style={{
                    padding: "14px",
                    background: "#ffffff",
                    border: "1px solid #e3eaf2",
                    borderRadius: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <div className="side-label" style={{ marginBottom: "10px" }}>
                    AUTHENTICATION FILTERS
                  </div>
                  <AuthFilterBar
                    filters={authFilters}
                    options={authenticationOptions}
                    setFilters={setAuthFilters}
                  />
                </div>

                <div className="kpi-grid compact">
                  <Kpi
                    label="Total Authentication Txn Cnt"
                    value={number(authenticationKpi.total)}
                    sub="authentication transactions"
                  />
                  <Kpi
                    label="Success Cnt"
                    value={number(authenticationKpi.success)}
                    sub="authenticated transactions"
                  />
                  <Kpi
                    label="Success Rate"
                    value={rate(authenticationKpi.successRate)}
                    sub="authenticated / total"
                  />
                  <Kpi
                    label="Challenge Success Rate"
                    value={rate(authenticationKpi.challengeSuccessRate)}
                    sub="authenticated / challenge"
                  />
                  <Kpi
                    label="Frictionless Success Rate"
                    value={rate(authenticationKpi.frictionlessSuccessRate)}
                    sub="authenticated / frictionless"
                  />
                </div>

                {/* ROW 1 — MONTHLY AUTHENTICATION + CHALLENGE / FRICTIONLESS MIX */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="MoM Authenticated Volumes"
                    subtitle="Authentication volume with total success rate"
                  >
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart
                        data={authenticationTrend}
                        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis
                          domain={([dataMin, dataMax]) => {
                            const range = dataMax - dataMin;
                            const padding = Math.max(range * 0.25, 1);
                            return [
                              Math.max(0, dataMin - padding),
                              dataMax + padding,
                            ];
                          }}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(value) => number(value)}
                        />
                        <Tooltip
                          formatter={(value, name, props) => {
                            if (name === "Success Rate") {
                              return [
                                `${Number(props?.payload?.successRate || 0).toFixed(1)}%`,
                                name,
                              ];
                            }
                            return [number(value), "Authentication Volume"];
                          }}
                        />
                        <Bar
                          dataKey="volume"
                          name="Authentication Volume"
                          fill="#46b5ff"
                          radius={[6, 6, 0, 0]}
                        />
                        <Line
                          type="monotone"
                          dataKey="successRateVisual"
                          name="Success Rate"
                          stroke="#66d4a6"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartCard>

                  <ChartCard
                    title="Challenge vs Frictionless"
                    subtitle="% share of authentication transactions"
                  >
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Pie
                          data={authenticationModeMix}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="48%"
                          outerRadius={100}
                          innerRadius={55}
                          paddingAngle={2}
                          label={({ name, percent }) =>
                            `${name} ${(percent * 100).toFixed(1)}%`
                          }
                        >
                          {authenticationModeMix.map((entry, index) => (
                            <Cell
                              key={`auth-mode-${index}`}
                              fill={
                                ["#46b5ff", "#66d4a6", "#ffb86b", "#ff6b87"][
                                  index % 4
                                ]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;

                            const data = payload[0]?.payload;
                            if (!data) return null;

                            return (
                              <div
                                style={{
                                  background: "#ffffff",
                                  border: "1px solid #e3eaf2",
                                  borderRadius: "8px",
                                  padding: "10px 12px",
                                  boxShadow: "0 4px 14px rgba(24, 38, 56, 0.10)",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 600,
                                    marginBottom: "6px",
                                    color: "#182638",
                                  }}
                                >
                                  {data.name}
                                </div>
                                <div style={{ color: "#718096" }}>
                                  Authentication Volume: {number(data.value)}
                                </div>
                                <div style={{ color: "#718096" }}>
                                  Share: {Number(data.share || 0).toFixed(1)}%
                                </div>
                                <div style={{ color: "#718096" }}>
                                  Authentication Success Rate:{" "}
                                  {Number(data.successRate || 0).toFixed(1)}%
                                </div>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>

                {/* ROW 2 — FAILURE REASONS + MANDATES */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  <ChartCard
                    title="Top 5 Authentication Failure Reasons"
                    subtitle="Failure count and % share of authentication failures"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {authenticationFailures.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={x.name}
                          >
                            {x.name}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong style={{ fontSize: "12px", color: "#182638" }}>
                              {number(x.value)}
                            </strong>
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {x.share.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>

                  <ChartCard
                    title="Top 5 Challenge Mandates"
                    subtitle="Authentication count and % share"
                  >
                    <div style={{ padding: "8px 4px" }}>
                      {authenticationMandates.map((x) => (
                        <div
                          key={x.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "10px 0",
                            borderBottom: "1px solid #e3eaf2",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#182638",
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={x.name}
                          >
                            {x.name}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              flexShrink: 0,
                            }}
                          >
                            <strong style={{ fontSize: "12px", color: "#182638" }}>
                              {number(x.value)}
                            </strong>
                            <span
                              style={{
                                minWidth: "52px",
                                textAlign: "right",
                                fontSize: "11px",
                                color: "#1677d2",
                                fontWeight: 700,
                              }}
                            >
                              {x.share.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
                </div>

                {/* ROW 3 — TOP MERCHANTS + MCCs */}
                <div className="chart-grid two" style={{ marginTop: "16px" }}>
                  {[
                    ["Top 10 Merchants", authenticationMerchants],
                    ["Top 10 MCCs", authenticationMCCs],
                  ].map(([title, data]) => (
                    <ChartCard
                      key={title}
                      title={title}
                      subtitle="Authentication count with success rate"
                    >
                      <div style={{ padding: "8px 4px" }}>
                        {data.map((x) => (
                          <div
                            key={x.name}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "16px",
                              padding: "10px 0",
                              borderBottom: "1px solid #e3eaf2",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "12px",
                                color: "#182638",
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={x.name}
                            >
                              {x.name}
                            </span>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                                flexShrink: 0,
                              }}
                            >
                              <strong style={{ fontSize: "12px", color: "#182638" }}>
                                {number(x.count)}
                              </strong>
                              <span
                                style={{
                                  minWidth: "52px",
                                  textAlign: "right",
                                  fontSize: "11px",
                                  color: "#1677d2",
                                  fontWeight: 700,
                                }}
                              >
                                {x.successRate.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ChartCard>
                  ))}
                </div>
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
               <div className="ai-analysis-buttons">
                <button
                  className={`generate-btn ${aiMode === "current_section" ? "active" : ""}`}
                  onClick={() => {
                    if (aiLoading) {
                      aiController?.abort();
                      return;
                    }
                  
                    setUserPrompt("");
                    setAiMode("current_section");
                    generateInsights("current_section");
                  }}
                  
                >
                  {aiLoading && aiMode === "current_section"
                    ? "Stop Analysis"
                    : "Analyze Current Section"}
                </button>
              
                <button
                  className={`generate-btn ${aiMode === "whole_dashboard" ? "active" : ""}`}
                  onClick={() => {
                    if (aiLoading) {
                      aiController?.abort();
                      return;
                    }
                  
                    setUserPrompt("");
                    setAiMode("whole_dashboard");
                    generateInsights("whole_dashboard");
                  }}
                  
                  
                >
                  {aiLoading && aiMode === "whole_dashboard"
                    ? "Stop Analysis"
                    : "Analyze Whole Dashboard"}
                </button>
              </div>
                <div className="ai-status">{aiStatus || "Ready"}</div>
              </div>

              <div className="ai-context">
                <div className="context-title">CONTEXT</div>
              
                <div className="context-grid">
                  <span>Analysis</span>
                  <strong>{aiMode === "whole_dashboard" ? "Whole Dashboard" : "Current Section"}</strong>

                  <span>View</span>
                  <strong>{aiContext.view}</strong>

                  {aiMode === "whole_dashboard" ? (
                    <>
                      <span>Auth Rows</span>
                      <strong>{number(aiContext.scope.authorizationRows)}</strong>
                      <span>Authentication Rows</span>
                      <strong>{number(aiContext.scope.authenticationRows)}</strong>
                    </>
                  ) : section === "authentication" ? (
                    <>
                      <span>Auth Transactions</span>
                      <strong>{number(aiContext.currentSectionContext.kpis.totalAuthenticationTransactions)}</strong>
                      <span>Success Rate</span>
                      <strong>{rate(aiContext.currentSectionContext.kpis.successRate)}</strong>
                      <span>Challenge Success</span>
                      <strong>{rate(aiContext.currentSectionContext.kpis.challengeSuccessRate)}</strong>
                      <span>Frictionless Success</span>
                      <strong>{rate(aiContext.currentSectionContext.kpis.frictionlessSuccessRate)}</strong>
                    </>
                  ) : section === "decline" ? (
                    <>
                      <span>Declined Transactions</span>
                      <strong>{number(aiContext.currentSectionContext.kpis.declinedTransactions)}</strong>
                      <span>Declined Value</span>
                      <strong>{money(aiContext.currentSectionContext.kpis.declinedValue)}</strong>
                      <span>Decline Rate</span>
                      <strong>{rate(aiContext.currentSectionContext.kpis.declineRate)}</strong>
                    </>
                  ) : (
                    <>
                      <span>Rows</span>
                      <strong>{number(aiContext.scope.authorizationRows)}</strong>
                      <span>Approval</span>
                      <strong>{rate(kpi.approvalRate)}</strong>
                      <span>Decline</span>
                      <strong>{rate(kpi.declineRate)}</strong>
                      <span>Fraud</span>
                      <strong>{rate(kpi.fraudRate)}</strong>
                      <span>Chargeback</span>
                      <strong>{rate(kpi.cbRate)}</strong>
                    </>
                  )}
                </div>

                {Object.entries(aiContext.filters || {}).some(([, values]) => Object.keys(values || {}).length > 0) && (
                  <div className="context-filters">
                    <div className="context-filter-title">ACTIVE FILTERS</div>
                    <div className="context-filter-list">
                      {Object.entries(aiContext.filters).flatMap(([scopeName, scopeFilters]) =>
                        Object.entries(scopeFilters || {}).map(([key, values]) => (
                          <div className="context-filter-item" key={`${scopeName}-${key}`}>
                            <span>{scopeName === "authentication" ? `Authentication · ${key}` : key}</span>
                            <strong>{values.join(", ")}</strong>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="ai-result">
                {aiResult ? (
                  <>{renderAIResult(aiResult)}</>
                ) : (
                  <div className="empty-ai">
                    <div className="empty-spark">✦</div>
                    <h3>Generate an analytical readout</h3>
                    <p>The AI will use the relevant filtered section data, visualizations, KPIs, decline signals, risk signals and authentication context.</p>
                  </div>
                )}
              </div>

              <div className="ai-prompt-box">
                <input
                  type="text"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && userPrompt.trim() && !aiLoading) {
                      const question = userPrompt.trim();
                      setUserPrompt("");
                      generateInsights(aiMode, question);
                    }
                  }}
                  placeholder="Ask AI anything about this dashboard..."
                  disabled={aiLoading}
                />

                <button
                  className="ai-prompt-send"
                  onClick={() => {
                    const question = userPrompt.trim();
                    if (!question) return;
                    setUserPrompt("");
                    generateInsights(aiMode, question);
                  }}
                  disabled={!userPrompt.trim() || aiLoading}
                >
                  Ask
                </button>
              </div>

              {aiPromptResult && (
                <div className="ai-prompt-result">
                  <div className="ai-prompt-result-title">
                    {aiPromptQuestion || "Your question"}
                  </div>
                  <div className="ai-prompt-result-body">
                    {renderAIResult(aiPromptResult)}
                  </div>
                </div>
              )}

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
