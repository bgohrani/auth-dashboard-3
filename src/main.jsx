import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Papa from "papaparse";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import "./styles.css";

const NAV = [
  ["overview", "Overview"],
  ["authorization", "Authorization Performance"],
  ["declines", "Decline Analysis"],
  ["risk", "Fraud & Chargebacks"]
];

const FILTERS = [
  ["year_month", "Month"],
  ["issuer_name", "Issuer"],
  ["acquirer_name", "Acquirer"],
  ["issuer_country", "Country"],
  ["channel", "Channel"],
  ["3DS", "3DS"],
  ["tokenization", "Tokenization"],
  ["entry mode code", "Entry Mode"],
  ["prod type", "Product"],
  ["wallet", "Wallet"],
  ["ticket size bands", "Ticket Size"]
];

const fmt = (n, digits=0) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: digits });
const money = n => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e9) return `$${(v/1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v/1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v/1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const pct = (n, digits=1) => `${Number(n || 0).toFixed(digits)}%`;
const sum = (rows, key) => rows.reduce((a,r) => a + Number(r[key] || 0), 0);
const uniq = (rows, key) => [...new Set(rows.map(r => r[key]).filter(v => v !== "" && v != null))];

function normalizeRows(rows) {
  return rows.map(r => ({
    ...r,
    "approved count": +r["approved count"] || 0,
    "decline count": +r["decline count"] || 0,
    "approved amt": +r["approved amt"] || 0,
    "decline amount": +r["decline amount"] || 0,
    "fraud count": +r["fraud count"] || 0,
    "fraud amt": +r["fraud amt"] || 0,
    "chargeback count": +r["chargeback count"] || 0,
    "first presentment amt": +r["first presentment amt"] || 0,
    "second presentment amt": +r["second presentment amt"] || 0,
    "arbitration amt": +r["arbitration amt"] || 0,
    "chargeback total": +r["chargeback total"] || 0
  }));
}

function aggregate(rows, key, valueKey, limit=10) {
  const m = new Map();
  rows.forEach(r => {
    const k = r[key] || "Unknown";
    m.set(k, (m.get(k) || 0) + Number(r[valueKey] || 0));
  });
  return [...m.entries()].map(([name,value]) => ({name,value})).sort((a,b)=>b.value-a.value).slice(0,limit);
}

function kpis(rows) {
  const approved = sum(rows,"approved count"), declined = sum(rows,"decline count");
  const volume = approved + declined;
  const fraud = sum(rows,"fraud count"), cb = sum(rows,"chargeback count");
  return {
    volume, value: sum(rows,"approved amt") + sum(rows,"decline amount"),
    approved, declined, approvalRate: volume ? approved/volume*100 : 0,
    declineRate: volume ? declined/volume*100 : 0,
    fraudRate: volume ? fraud/volume*100 : 0,
    chargebackRate: volume ? cb/volume*100 : 0,
    fraud, cb, fraudAmt: sum(rows,"fraud amt"), cbAmt: sum(rows,"chargeback total")
  };
}

function App() {
  const [rows,setRows] = useState([]);
  const [view,setView] = useState("overview");
  const [filters,setFilters] = useState(Object.fromEntries(FILTERS.map(([k])=>[k,"All"])));
  const [aiOpen,setAiOpen] = useState(false);
  const [aiLoading,setAiLoading] = useState(false);
  const [aiText,setAiText] = useState("");
  const [loaded,setLoaded] = useState(false);
  const [dataError,setDataError] = useState("");

  useEffect(() => {
    // Load the dashboard data directly from the supplied Google Sheet.
    // The Google Sheet must be shared/published so its CSV export is readable.
    const sheetCsvUrl =
      "https://docs.google.com/spreadsheets/d/1tadSeuYgEliS2cOkH-9uR31NUDS7Mt2PXjiB_-1EW44/export?format=csv";

    Papa.parse(sheetCsvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: res => {
        if (res.errors?.length) {
          console.warn("Google Sheets CSV parse warnings:", res.errors.slice(0, 5));
        }
        setRows(normalizeRows(res.data));
        setLoaded(true);
      },
      error: err => {
        console.error("Could not load Google Sheets data:", err);
        setDataError("Could not load the Google Sheet. Check that the sheet is shared/published and try refreshing.");
        setLoaded(true);
      }
    });
  }, []);

  const filtered = useMemo(() => rows.filter(r =>
    Object.entries(filters).every(([k,v]) => v === "All" || String(r[k]) === String(v))
  ), [rows,filters]);

  const metrics = useMemo(() => kpis(filtered), [filtered]);

  const options = useMemo(() => Object.fromEntries(
    FILTERS.map(([k]) => [k, uniq(rows,k).sort()])
  ), [rows]);

  const context = useMemo(() => buildAIContext(view, filters, filtered), [view,filters,filtered]);

  async function generateAI() {
    setAiOpen(true); setAiLoading(true); setAiText("");
    const endpoint = import.meta.env.VITE_AI_INSIGHTS_URL;
    try {
      if (endpoint) {
        const res = await fetch(endpoint, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify(context)
        });
        if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
        const data = await res.json();
        setAiText(data.insights || data.text || JSON.stringify(data, null, 2));
      } else {
        await new Promise(r=>setTimeout(r,650));
        setAiText(localInsights(view, filtered, metrics));
      }
    } catch (e) {
      setAiText(`AI service could not be reached. ${e.message}`);
    } finally { setAiLoading(false); }
  }

  if (!loaded) return <div className="loading"><div className="loader"></div><span>Loading authorization intelligence…</span></div>;
  if (dataError) return <div className="loading"><div><strong>Data connection error</strong><br/><span>{dataError}</span></div></div>;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div><div className="brand-title">Authorization Intelligence</div><div className="brand-sub">Payments analytics</div></div>
        </div>
        <nav className="nav">
          {NAV.map(([id,label]) => <button key={id} className={`nav-btn ${view===id?"active":""}`} onClick={()=>setView(id)}>{label}</button>)}
        </nav>
        <button className="ai-top" onClick={generateAI}><span>✦</span> AI Insights</button>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="filter-head"><div><div className="eyebrow">GLOBAL FILTERS</div><h3>Data scope</h3></div>
            <button className="reset" onClick={()=>setFilters(Object.fromEntries(FILTERS.map(([k])=>[k,"All"])))}>Reset</button>
          </div>
          <div className="filter-note">Filters persist across all four views.</div>
          {FILTERS.map(([key,label],i) => (
            <div className={`filter ${i>4 ? "secondary-filter":""}`} key={key}>
              <label>{label}</label>
              <select value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}>
                <option>All</option>{options[key].map(v=><option key={String(v)}>{v}</option>)}
              </select>
            </div>
          ))}
          <div className="scope"><span className="dot"></span>{fmt(filtered.length)} rows in scope</div>
        </aside>

        <main className="content">
          <div className="view-head">
            <div>
              <div className="eyebrow">ANALYTICS VIEW</div>
              <h1>{NAV.find(x=>x[0]===view)[1]}</h1>
              <p>{viewDescription(view)}</p>
            </div>
            <button className="ai-secondary" onClick={generateAI}>✦ Generate insights</button>
          </div>
          {view==="overview" && <Overview rows={filtered} metrics={metrics}/>}
          {view==="authorization" && <Authorization rows={filtered} metrics={metrics}/>}
          {view==="declines" && <Declines rows={filtered} metrics={metrics}/>}
          {view==="risk" && <Risk rows={filtered} metrics={metrics}/>}
        </main>
      </div>

      <AnimatePresence>
        {aiOpen && <motion.div className="drawer-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setAiOpen(false)}>
          <motion.aside className="ai-drawer" initial={{x:"100%"}} animate={{x:0}} exit={{x:"100%"}} transition={{type:"spring",damping:28,stiffness:250}} onClick={e=>e.stopPropagation()}>
            <div className="drawer-head"><div><div className="eyebrow">CONTEXTUAL ASSISTANT</div><h2>AI Insights</h2></div><button onClick={()=>setAiOpen(false)}>×</button></div>
            <div className="ai-context"><b>{NAV.find(x=>x[0]===view)[1]}</b><span>{fmt(filtered.length)} rows · current filters applied</span></div>
            <button className="generate" onClick={generateAI} disabled={aiLoading}>{aiLoading ? "Analyzing…" : "✦ Generate Insights"}</button>
            <div className="ai-result">{aiLoading ? <div className="ai-loading"><div className="loader small"></div>Analyzing dashboard context…</div> : <InsightText text={aiText}/>}</div>
          </motion.aside>
        </motion.div>}
      </AnimatePresence>
    </div>
  );
}

function viewDescription(v){
  return {
    overview:"A portfolio-level snapshot of authorization health, volume, value and emerging risk.",
    authorization:"Understand where approvals are strong or weak across transaction characteristics.",
    declines:"Diagnose the response codes and transaction attributes behind authorization declines.",
    risk:"Connect fraud and chargeback exposure back to transaction behavior."
  }[v];
}

function KPI({label,value,sub,positive}) {
  return <motion.div className="kpi" whileHover={{y:-2}}>
    <div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className={`kpi-sub ${positive===true?"up":positive===false?"down":""}`}>{sub}</div>
  </motion.div>;
}
const ChartBox=({title,subtitle,children,wide=false})=><div className={`chart-box ${wide?"wide":""}`}><div className="chart-title">{title}</div>{subtitle&&<div className="chart-sub">{subtitle}</div>}<div className="chart">{children}</div></div>;
const Tip=({active,payload,label})=>active&&payload?.length?<div className="tooltip"><div>{label}</div><strong>{payload[0].name || payload[0].dataKey}: {fmt(payload[0].value,1)}</strong></div>:null;

function Overview({rows,metrics}) {
  const trend = aggregateTrend(rows);
  const channel = aggregate(rows,"channel","approved count",8);
  const declines = aggregate(rows,"response_description","decline count",6);
  const risk = [
    {name:"Fraud",value:metrics.fraudAmt},
    {name:"Chargeback",value:metrics.cbAmt}
  ];
  return <><div className="kpi-grid">
    <KPI label="Authorization volume" value={fmt(metrics.volume)} sub={`${fmt(metrics.approved)} approved`} positive/>
    <KPI label="Authorization value" value={money(metrics.value)} sub="Approved + declined value"/>
    <KPI label="Approval rate" value={pct(metrics.approvalRate)} sub={`${pct(metrics.declineRate)} decline rate`} positive={metrics.approvalRate>=90}/>
    <KPI label="Fraud rate" value={pct(metrics.fraudRate,2)} sub={money(metrics.fraudAmt)} />
    <KPI label="Chargeback rate" value={pct(metrics.chargebackRate,2)} sub={money(metrics.cbAmt)} />
  </div>
  <div className="grid two">
    <ChartBox title="Authorization trend" subtitle="Volume by month" wide><ResponsiveContainer><AreaChart data={trend}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopOpacity=".28"/><stop offset="95%" stopOpacity=".02"/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month"/><YAxis tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/><Tooltip content={<Tip/>}/><Area type="monotone" dataKey="volume" stroke="var(--accent)" fill="url(#fill)" strokeWidth={2}/></AreaChart></ResponsiveContainer></ChartBox>
    <ChartBox title="Volume by channel" subtitle="Approved transaction volume"><ResponsiveContainer><BarChart data={channel} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" hide/><YAxis dataKey="name" type="category" width={85}/><Tooltip content={<Tip/>}/><Bar dataKey="value" fill="var(--accent)" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></ChartBox>
  </div>
  <div className="grid two">
    <ChartBox title="Top decline drivers" subtitle="Response codes by declined volume"><ResponsiveContainer><BarChart data={declines}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{fontSize:10}} interval={0}/><YAxis tickFormatter={v=>`${(v/1000).toFixed(0)}K`}/><Tooltip content={<Tip/>}/><Bar dataKey="value" fill="var(--ink)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></ChartBox>
    <ChartBox title="Risk exposure" subtitle="Fraud and chargeback amounts"><ResponsiveContainer><PieChart><Pie data={risk} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={4}>{risk.map((_,i)=><Cell key={i} fill={i===0?"var(--accent)":"var(--warn)"}/>)}</Pie><Tooltip formatter={v=>money(v)}/><Legend/></PieChart></ResponsiveContainer></ChartBox>
  </div></>;
}

function Authorization({rows,metrics}) {
  const byChannel = rateBy(rows,"channel");
  const byEntry = rateBy(rows,"entry mode code");
  const by3ds = rateBy(rows,"3DS");
  return <><div className="kpi-grid four"><KPI label="Approved transactions" value={fmt(metrics.approved)} sub={pct(metrics.approvalRate)+" of volume"} positive/><KPI label="Approved value" value={money(sum(rows,"approved amt"))} sub="Successful authorization value"/><KPI label="Declined transactions" value={fmt(metrics.declined)} sub={pct(metrics.declineRate)+" of volume"}/><KPI label="Avg approved ticket" value={money(metrics.approved?sum(rows,"approved amt")/metrics.approved:0)} sub="Approved value / approved txn"/></div>
  <div className="grid two"><ChartBox title="Approval rate by channel" subtitle="Approval share of transaction volume"><ResponsiveContainer><BarChart data={byChannel}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[0,100]} tickFormatter={v=>`${v}%`}/><Tooltip formatter={v=>pct(v)}/><Bar dataKey="rate" fill="var(--accent)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></ChartBox>
  <ChartBox title="Approval rate by entry mode" subtitle="Transaction entry behavior"><ResponsiveContainer><BarChart data={byEntry} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`}/><YAxis type="category" dataKey="name" width={105}/><Tooltip formatter={v=>pct(v)}/><Bar dataKey="rate" fill="var(--ink)" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></ChartBox></div>
  <div className="grid two"><ChartBox title="3DS performance" subtitle="Approval rate by 3DS status"><ResponsiveContainer><BarChart data={by3ds}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[0,100]} tickFormatter={v=>`${v}%`}/><Tooltip formatter={v=>pct(v)}/><Bar dataKey="rate" fill="var(--accent)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></ChartBox>
  <ChartBox title="Approval value trend" subtitle="Approved transaction value by month"><ResponsiveContainer><LineChart data={aggregateTrend(rows)}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month"/><YAxis tickFormatter={v=>money(v)}/><Tooltip formatter={v=>money(v)}/><Line type="monotone" dataKey="approvedValue" stroke="var(--accent)" strokeWidth={3} dot={false}/></LineChart></ResponsiveContainer></ChartBox></div></>;
}

function Declines({rows,metrics}) {
  const codes = aggregate(rows,"response_description","decline count",10);
  const channels = rateBy(rows,"channel","decline");
  const entry = rateBy(rows,"entry mode code","decline");
  return <><div className="kpi-grid four"><KPI label="Declined transactions" value={fmt(metrics.declined)} sub={pct(metrics.declineRate)+" of volume"}/><KPI label="Declined value" value={money(sum(rows,"decline amount"))} sub="Value associated with declines"/><KPI label="Largest decline reason" value={codes[0]?.name?.split(" - ")[0] || "—"} sub={codes[0] ? fmt(codes[0].value)+" declined txns" : "No data"}/><KPI label="Decline reasons" value={fmt(new Set(rows.map(r=>r.response_description)).size)} sub="Distinct response descriptions"/></div>
  <div className="grid two"><ChartBox title="Decline reason distribution" subtitle="Top response descriptions"><ResponsiveContainer><BarChart data={codes} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="name" width={180} tick={{fontSize:10}}/><Tooltip content={<Tip/>}/><Bar dataKey="value" fill="var(--ink)" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></ChartBox>
  <ChartBox title="Decline rate by channel" subtitle="Share of transactions declined"><ResponsiveContainer><BarChart data={channels}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[0,100]} tickFormatter={v=>`${v}%`}/><Tooltip formatter={v=>pct(v)}/><Bar dataKey="rate" fill="var(--warn)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></ChartBox></div>
  <ChartBox title="Decline rate by entry mode" subtitle="Potential friction points"><ResponsiveContainer><BarChart data={entry}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[0,100]} tickFormatter={v=>`${v}%`}/><Tooltip formatter={v=>pct(v)}/><Bar dataKey="rate" fill="var(--accent)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></ChartBox></>;
}

function Risk({rows,metrics}) {
  const fraud = aggregate(rows,"fraud reason","fraud count",8).filter(x=>x.name!=="No Fraud");
  const cb = aggregate(rows,"chargeback reason","chargeback count",8).filter(x=>x.name!=="No Chargeback");
  const fraudChannel = rateBy(rows,"channel","fraud");
  return <><div className="kpi-grid four"><KPI label="Fraud transactions" value={fmt(metrics.fraud)} sub={pct(metrics.fraudRate,2)+" of volume"}/><KPI label="Fraud exposure" value={money(metrics.fraudAmt)} sub="Fraud amount"/><KPI label="Chargebacks" value={fmt(metrics.cb)} sub={pct(metrics.chargebackRate,2)+" of volume"}/><KPI label="Chargeback exposure" value={money(metrics.cbAmt)} sub="Total chargeback amount"/></div>
  <div className="grid two"><ChartBox title="Fraud reasons" subtitle="Fraud transaction count"><ResponsiveContainer><BarChart data={fraud} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="name" width={140}/><Tooltip content={<Tip/>}/><Bar dataKey="value" fill="var(--accent)" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></ChartBox>
  <ChartBox title="Chargeback reasons" subtitle="Chargeback transaction count"><ResponsiveContainer><BarChart data={cb} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="name" width={140}/><Tooltip content={<Tip/>}/><Bar dataKey="value" fill="var(--warn)" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></ChartBox></div>
  <ChartBox title="Fraud rate by channel" subtitle="Fraud transactions as a share of authorization volume"><ResponsiveContainer><BarChart data={fraudChannel}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis tickFormatter={v=>`${v.toFixed(2)}%`}/><Tooltip formatter={v=>pct(v,2)}/><Bar dataKey="rate" fill="var(--accent)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></ChartBox></>;
}

function aggregateTrend(rows) {
  const m = new Map();
  rows.forEach(r=>{
    const k=String(r.year_month||"Unknown");
    const x=m.get(k)||{month:k,volume:0,approvedValue:0};
    x.volume += (+r["approved count"]||0)+(+r["decline count"]||0);
    x.approvedValue += +r["approved amt"]||0;
    m.set(k,x);
  });
  return [...m.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
function rateBy(rows,key,mode="approval") {
  const m=new Map();
  rows.forEach(r=>{
    const k=r[key]||"Unknown", x=m.get(k)||{vol:0,approved:0,declined:0,fraud:0};
    x.approved += +r["approved count"]||0; x.declined += +r["decline count"]||0; x.fraud += +r["fraud count"]||0;
    x.vol += (+r["approved count"]||0)+(+r["decline count"]||0); m.set(k,x);
  });
  return [...m.entries()].map(([name,x])=>({name,rate:x.vol?(mode==="decline"?x.declined:x.vol?mode==="fraud"?x.fraud:x.approved:x.vol)/x.vol*100:0})).sort((a,b)=>b.rate-a.rate);
}
function buildAIContext(view, filters, rows) {
  const m=kpis(rows);
  return {view, filters, rowsInScope:rows.length, kpis:m,
    trends:aggregateTrend(rows), declineReasons:aggregate(rows,"response_description","decline count",10),
    fraudReasons:aggregate(rows,"fraud reason","fraud count",10),
    chargebackReasons:aggregate(rows,"chargeback reason","chargeback count",10)};
}
function localInsights(view, rows, m) {
  const decline=aggregate(rows,"response_description","decline count",3)[0];
  const fraud=aggregate(rows,"fraud reason","fraud count",5).find(x=>x.name!=="No Fraud");
  const cb=aggregate(rows,"chargeback reason","chargeback count",5).find(x=>x.name!=="No Chargeback");
  const lines=[];
  if(view==="overview"||view==="authorization") lines.push(`Approval rate is ${pct(m.approvalRate)} across ${fmt(m.volume)} transactions in the current scope.`);
  if(decline) lines.push(`${decline.name} is the largest decline driver, with ${fmt(decline.value)} declined transactions in scope.`);
  if(view==="risk"||view==="overview") {
    if(fraud) lines.push(`${fraud.name} is the leading recorded fraud reason in the current data.`);
    if(cb) lines.push(`${cb.name} is the leading recorded chargeback reason in the current data.`);
  }
  if(!lines.length) lines.push("There is not enough activity in the current filter selection to generate a meaningful insight.");
  return lines.map(x=>`• ${x}`).join("\n\n");
}
function InsightText({text}) {
  if(!text) return <div className="empty-ai">Select filters and generate insights to analyze the current dashboard context.</div>;
  return <div className="insight-text">{text.split("\n").map((x,i)=><p key={i}>{x}</p>)}</div>;
}

createRoot(document.getElementById("root")).render(<App />);
