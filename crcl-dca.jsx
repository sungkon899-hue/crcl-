import { useState, useMemo } from "react";

// ============================================================
// CRCL DCA 智能定投评分系统 v3 · Darwin Evolution
// R1: 数据编辑面板（MVP可用化）
// R2: 移动端全适配（auto-fit grid）
// R3: 风控逻辑落地（成本价+回撤+仓位熔断）
// ============================================================

const C = {
  bg: "#f5f0e8", card: "#ffffff", cardBorder: "#e8e0d0",
  orange: "#e8820c", orangeLight: "#f5a623", orangeBg: "rgba(232,130,12,0.06)",
  text: "#2a2a2a", textSub: "#888888", textMuted: "#b0a89a",
  green: "#22a06b", red: "#e5484d", headerBg: "#1a1a1a",
};

const DEFAULT_DATA = {
  price: 100.42, priceChg: 9.70,
  ma200: 112.5, ma50: 88.3,
  rsi14: 58.2, bbPos: 0.62, macdSig: "bullish",
  usdcSupply: 77.2, usdc30d: 75.8, usdcYoY: 72,
  ffr: 4.50, ffrTrend: "stable", t2y: 3.95,
  vix: 24.8, cfg: 62,
  ps: 5.76, psPct: 35,
  nextER: "2026-05-11", updated: "2026-05-03", pulse: 0,
};

// ── Scoring Engine ──
function sVal(d) {
  const dev = (d.price - d.ma200) / d.ma200;
  let ma = dev <= -0.3 ? 95 : dev <= 0 ? 50 + (-dev / 0.3) * 45 : dev <= 0.5 ? 50 - (dev / 0.5) * 45 : 5;
  return Math.round(ma * 0.6 + (100 - d.psPct) * 0.4);
}
function sUsdc(d) {
  const g = ((d.usdcSupply - d.usdc30d) / d.usdc30d) * 100;
  let gs = g >= 3 ? 90 : g >= 1 ? 50 + ((g - 1) / 2) * 40 : g >= 0 ? 30 + g * 20 : Math.max(10, 30 + g * 10);
  let yb = d.usdcYoY >= 50 ? 15 : d.usdcYoY >= 30 ? 10 : d.usdcYoY >= 10 ? 5 : 0;
  return Math.min(100, Math.round(gs * 0.7 + (50 + yb) * 0.3));
}
function sRate(d) {
  let r = d.ffr >= 3.5 && d.ffr <= 5 ? 75 : d.ffr >= 2.5 ? 55 : d.ffr >= 1.5 ? 35 : 20;
  let t = d.ffrTrend === "stable" ? 10 : d.ffrTrend === "falling" ? -5 : 5;
  return Math.min(100, Math.max(0, r + t));
}
function sTech(d) {
  let rsi = d.rsi14 <= 20 ? 95 : d.rsi14 <= 30 ? 80 : d.rsi14 <= 50 ? 50 + ((50 - d.rsi14) / 20) * 30 : d.rsi14 <= 70 ? 50 - ((d.rsi14 - 50) / 20) * 30 : 15;
  return Math.round(rsi * 0.5 + (100 - d.bbPos * 80) * 0.3 + (d.macdSig === "bullish" ? 60 : 40) * 0.2);
}
function sSent(d) {
  let v = d.vix >= 35 ? 95 : d.vix >= 25 ? 60 + ((d.vix - 25) / 10) * 35 : d.vix >= 15 ? 40 + ((d.vix - 15) / 10) * 20 : 20;
  return Math.round(v * 0.5 + (100 - d.cfg) * 0.5);
}
function toMult(s) {
  if (s <= 30) return +(0.1 + (s / 30) * 0.2).toFixed(2);
  if (s <= 50) return +(0.3 + ((s - 30) / 20) * 0.5).toFixed(2);
  if (s <= 70) return +(0.8 + ((s - 50) / 20) * 0.4).toFixed(2);
  if (s <= 85) return +(1.2 + ((s - 70) / 15) * 0.8).toFixed(2);
  return +(2.0 + ((s - 85) / 15) * 1.0).toFixed(2);
}
function labelOf(s) { return s >= 85 ? "极度低估" : s >= 70 ? "偏低估" : s >= 50 ? "合理估值" : s >= 30 ? "偏高估" : "高估区间"; }

// ── Risk Engine (R3) ──
function calcRisk(price, costBasis, positionPct, totalAssets, mult, base) {
  const drawdown = costBasis > 0 ? ((price - costBasis) / costBasis) * 100 : 0;
  const weeklyMax = base * 3;
  const todayAmt = Math.round(base * mult);
  const alerts = [];
  if (drawdown <= -30) alerts.push({ level: "🔴", msg: `回撤 ${drawdown.toFixed(1)}% ≥30%，触发熔断，暂停定投`, action: "halt" });
  else if (drawdown <= -20) alerts.push({ level: "🟠", msg: `回撤 ${drawdown.toFixed(1)}%，接近熔断线` });
  if (positionPct >= 20) alerts.push({ level: "🔴", msg: `CRCL仓位 ${positionPct.toFixed(1)}% ≥20%上限，停止加仓`, action: "halt" });
  else if (positionPct >= 15) alerts.push({ level: "🟠", msg: `CRCL仓位 ${positionPct.toFixed(1)}%，接近20%上限` });
  if (todayAmt * 5 > weeklyMax) alerts.push({ level: "🟡", msg: `当前倍数下周投入可能超过限额 $${weeklyMax}` });
  const halted = alerts.some(a => a.action === "halt");
  return { drawdown, weeklyMax, alerts, halted, todayAmt: halted ? 0 : todayAmt };
}

// ── Radar Chart ──
function Radar({ dims, size = 270 }) {
  const cx = size / 2, cy = size / 2, r = size * 0.33;
  const keys = Object.keys(dims), n = keys.length, step = (2 * Math.PI) / n, start = -Math.PI / 2;
  const pt = (i, v) => { const a = start + i * step; return [cx + (v / 100) * r * Math.cos(a), cy + (v / 100) * r * Math.sin(a)]; };
  const grids = [25, 50, 75, 100], lbls = ["估值", "USDC", "利率", "技术", "情绪"];
  const dp = keys.map((k, i) => pt(i, dims[k].score));
  const path = dp.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ") + "Z";
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size, display: "block", margin: "0 auto" }}>
      {grids.map(g => { const ps = Array.from({ length: n }, (_, i) => pt(i, g)); return <polygon key={g} points={ps.map(p => p.join(",")).join(" ")} fill="none" stroke="#e0d8c8" strokeWidth={1} />; })}
      {keys.map((_, i) => { const [ex, ey] = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={ex} y2={ey} stroke="#e0d8c8" strokeWidth={1} />; })}
      <polygon points={dp.map(p => p.join(",")).join(" ")} fill="rgba(232,130,12,0.15)" stroke={C.orange} strokeWidth={2.5} />
      {dp.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4.5} fill={C.orange} stroke="#fff" strokeWidth={2} />)}
      {keys.map((k, i) => { const [lx, ly] = pt(i, 125); return <text key={`l${i}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="#888" fontSize={12} fontWeight="600">{lbls[i]} {dims[k].score}</text>; })}
      {grids.map(g => <text key={`g${g}`} x={cx + 4} y={cy - (g / 100) * r - 2} fill="#c8c0b0" fontSize={9} fontFamily="monospace">{g}</text>)}
    </svg>
  );
}

// ── Score Ring ──
function Ring({ score, size = 170 }) {
  const cx = size / 2, cy = size / 2, r = size * 0.4, circ = 2 * Math.PI * r, prog = (score / 100) * circ * 0.75;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", margin: "0 auto" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0e8d8" strokeWidth={12} strokeDasharray={`${circ * 0.75} ${circ}`} strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.orange} strokeWidth={12} strokeDasharray={`${prog} ${circ}`} strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 0.8s ease" }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fill={C.orange} fontSize={46} fontWeight="bold" fontFamily="'Space Mono',monospace">{score}</text>
      <text x={cx} y={cy + 20} textAnchor="middle" fill={C.textMuted} fontSize={14} fontFamily="monospace">/ 100</text>
    </svg>
  );
}

// ── Dimension Card ──
function DimCard({ name, nameEn, weight, score, rawVal, desc }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div><span style={{ color: C.orange, fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>{nameEn}</span><span style={{ color: C.textSub, fontSize: 12, marginLeft: 6 }}>· {name}</span></div>
        <span style={{ background: "#f5f0e8", border: "1px solid #e0d8c8", borderRadius: 20, padding: "2px 10px", fontSize: 11, color: C.textSub, fontFamily: "monospace" }}>{weight}%</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
        <span style={{ color: C.orange, fontSize: 34, fontWeight: 800, fontFamily: "'Space Mono',monospace", lineHeight: 1 }}>{score}</span>
        <span style={{ color: C.textMuted, fontSize: 12, fontFamily: "monospace" }}>/ 100 · {rawVal}</span>
      </div>
      <div style={{ color: C.green, fontSize: 11, marginBottom: 6 }}>已更新</div>
      <div style={{ height: 5, background: "#f0e8d8", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${score}%`, height: "100%", background: `linear-gradient(90deg, ${C.orangeLight}, ${C.orange})`, borderRadius: 3, transition: "width 0.8s" }} />
      </div>
      <p style={{ color: C.textSub, fontSize: 12, lineHeight: 1.6, margin: 0 }}>{desc}</p>
    </div>
  );
}

// ── R1: Data Editor Panel ──
function DataEditor({ data, onChange, onClose }) {
  const fields = [
    { section: "📈 价格 & 估值", items: [
      { key: "price", label: "CRCL 股价", unit: "$", step: 0.01 },
      { key: "priceChg", label: "日涨跌幅", unit: "%", step: 0.01 },
      { key: "ma200", label: "200日均线", unit: "$", step: 0.1 },
      { key: "ma50", label: "50日均线", unit: "$", step: 0.1 },
      { key: "ps", label: "PS (市销率)", step: 0.01 },
      { key: "psPct", label: "PS 历史百分位", unit: "%", step: 1 },
    ]},
    { section: "💵 USDC 生态", items: [
      { key: "usdcSupply", label: "USDC 流通量", unit: "B$", step: 0.1 },
      { key: "usdc30d", label: "30天前流通量", unit: "B$", step: 0.1 },
      { key: "usdcYoY", label: "同比增长", unit: "%", step: 1 },
    ]},
    { section: "🏦 利率环境", items: [
      { key: "ffr", label: "联邦基金利率", unit: "%", step: 0.25 },
      { key: "t2y", label: "2年期美债", unit: "%", step: 0.01 },
    ]},
    { section: "📊 技术面", items: [
      { key: "rsi14", label: "RSI(14)", step: 0.1 },
      { key: "bbPos", label: "布林带位置(0-1)", step: 0.01 },
    ]},
    { section: "🧠 市场情绪", items: [
      { key: "vix", label: "VIX 指数", step: 0.1 },
      { key: "cfg", label: "加密恐惧贪婪(0-100)", step: 1 },
    ]},
    { section: "⚙️ 调节", items: [
      { key: "pulse", label: "财报脉冲(-10~+10)", step: 1 },
    ]},
  ];
  const set = (key, val) => onChange({ ...data, [key]: parseFloat(val) || 0 });
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(380px, 92vw)", background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)", zIndex: 1000, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.cardBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div><div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>📝 数据面板</div><div style={{ fontSize: 11, color: C.textMuted }}>修改 → 实时重算评分</div></div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textSub, cursor: "pointer", padding: "4px" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "10px 18px" }}>
        {/* Toggles */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 5 }}>🏦 利率趋势</div>
          <div style={{ display: "flex", gap: 5 }}>
            {["rising", "stable", "falling"].map(v => (
              <button key={v} onClick={() => onChange({ ...data, ffrTrend: v })} style={{
                flex: 1, padding: "5px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: data.ffrTrend === v ? C.orangeBg : "#f5f0e8",
                border: `1.5px solid ${data.ffrTrend === v ? C.orange : "#e0d8c8"}`,
                color: data.ffrTrend === v ? C.orange : C.textSub,
              }}>{v === "rising" ? "↑上行" : v === "stable" ? "→稳定" : "↓下行"}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 5 }}>📊 MACD 信号</div>
          <div style={{ display: "flex", gap: 5 }}>
            {["bullish", "bearish"].map(v => (
              <button key={v} onClick={() => onChange({ ...data, macdSig: v })} style={{
                flex: 1, padding: "5px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: data.macdSig === v ? C.orangeBg : "#f5f0e8",
                border: `1.5px solid ${data.macdSig === v ? C.orange : "#e0d8c8"}`,
                color: data.macdSig === v ? C.orange : C.textSub,
              }}>{v === "bullish" ? "🟢 多头" : "🔴 空头"}</button>
            ))}
          </div>
        </div>
        {fields.map((sec, si) => (
          <div key={si} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{sec.section}</div>
            {sec.items.map(f => (
              <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <label style={{ fontSize: 11.5, color: C.textSub, width: 115, flexShrink: 0 }}>{f.label}</label>
                <input type="number" value={data[f.key]} step={f.step} onChange={e => set(f.key, e.target.value)}
                  style={{ flex: 1, padding: "5px 7px", borderRadius: 6, border: `1.5px solid ${C.cardBorder}`, fontSize: 13, fontFamily: "'Space Mono',monospace", outline: "none", background: "#faf8f4", color: C.text }} />
                {f.unit && <span style={{ fontSize: 10, color: C.textMuted, width: 22 }}>{f.unit}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.cardBorder}`, flexShrink: 0 }}>
        <button onClick={() => onChange({ ...DEFAULT_DATA })} style={{ width: "100%", padding: "8px", borderRadius: 8, border: `1px solid ${C.cardBorder}`, background: "#f5f0e8", color: C.textSub, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>🔄 重置默认</button>
      </div>
    </div>
  );
}

// ── MAIN ──
export default function App() {
  const [data, setData] = useState({ ...DEFAULT_DATA });
  const [base, setBase] = useState(100);
  const [editorOpen, setEditorOpen] = useState(false);
  const [costBasis, setCostBasis] = useState(0);
  const [positionPct, setPositionPct] = useState(5);
  const [totalAssets, setTotalAssets] = useState(50000);

  const dims = useMemo(() => ({
    val: { score: sVal(data), name: "估值偏离", en: "Valuation", w: 30, raw: `偏离 ${(((data.price - data.ma200) / data.ma200) * 100).toFixed(1)}%`, desc: `股价vs200日均线偏离度+PS历史百分位。PS=${data.ps}，历史${data.psPct}%分位。<-30%极度低估，0%合理，>+50%高估。` },
    usdc: { score: sUsdc(data), name: "USDC生态", en: "USDC Supply", w: 25, raw: `$${data.usdcSupply}B`, desc: `USDC流通量=Circle收入基数。$${data.usdcSupply}B，30日+${(((data.usdcSupply - data.usdc30d) / data.usdc30d) * 100).toFixed(1)}%，YoY+${data.usdcYoY}%。` },
    rate: { score: sRate(data), name: "利率环境", en: "Rate Env", w: 20, raw: `FFR ${data.ffr}%`, desc: `Circle~95%收入来自储备利息。FFR ${data.ffr}%${data.ffrTrend === "stable" ? "稳定" : data.ffrTrend === "falling" ? "下行" : "上行"}。3.5-5%最优区间。` },
    tech: { score: sTech(data), name: "技术面", en: "Technical", w: 15, raw: `RSI ${data.rsi14}`, desc: `RSI(14)=${data.rsi14}，布林带${(data.bbPos * 100).toFixed(0)}%，MACD${data.macdSig === "bullish" ? "多头" : "空头"}。<30超卖=买，>70超买=慎。` },
    sent: { score: sSent(data), name: "市场情绪", en: "Sentiment", w: 10, raw: `VIX ${data.vix}`, desc: `VIX=${data.vix}，加密F&G=${data.cfg}/100。CRCL受双市场影响，两个都恐惧=最佳买入。` },
  }), [data]);

  const composite = Math.min(100, Math.max(0, Math.round(dims.val.score * 0.3 + dims.usdc.score * 0.25 + dims.rate.score * 0.2 + dims.tech.score * 0.15 + dims.sent.score * 0.1) + data.pulse));
  const mult = toMult(composite);
  const daysToER = Math.ceil((new Date(data.nextER) - new Date("2026-05-03")) / 86400000);
  const risk = calcRisk(data.price, costBasis, positionPct, totalAssets, mult, base);
  const dimKeys = Object.keys(dims);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "-apple-system,'Segoe UI',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}`}</style>

      {editorOpen && <>
        <div onClick={() => setEditorOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 999 }} />
        <DataEditor data={data} onChange={setData} onClose={() => setEditorOpen(false)} />
      </>}

      {/* NAV */}
      <nav style={{ background: C.headerBg, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: "#333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: C.orange, fontWeight: 900, fontFamily: "'Space Mono',monospace" }}>C</div>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>CRCL DCA</span>
          <span style={{ color: "#555", fontSize: 10, fontFamily: "'Space Mono',monospace" }}>v3 Darwin</span>
        </div>
        <button onClick={() => setEditorOpen(true)} style={{ background: C.orange, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📝 编辑数据</button>
      </nav>

      {/* TICKER */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${C.cardBorder}`, padding: "5px 16px", display: "flex", alignItems: "center", gap: 8, overflowX: "auto", fontSize: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 3, background: C.orange, color: "#fff", fontSize: 10, fontWeight: 900, fontFamily: "'Space Mono',monospace", flexShrink: 0 }}>C</span>
        <span style={{ fontWeight: 600 }}>CRCL</span>
        <span style={{ fontFamily: "'Space Mono',monospace" }}>${data.price}</span>
        <span style={{ color: data.priceChg >= 0 ? C.green : C.red, fontFamily: "'Space Mono',monospace" }}>{data.priceChg >= 0 ? "+" : ""}{data.priceChg}%</span>
        <span style={{ color: C.orange, fontWeight: 700 }}>评分 {composite}</span>
        <span style={{ border: `1.5px solid ${C.orange}`, borderRadius: 4, padding: "0px 7px", color: C.orange, fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>{risk.halted ? "⛔" : `${mult}x`}</span>
        {risk.halted && <span style={{ color: C.red, fontWeight: 700, fontSize: 11 }}>熔断</span>}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 14px" }}>
        {/* HERO TITLE */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "0 0 2px" }}>今日定投建议</h1>
          <p style={{ color: C.textMuted, fontSize: 11, fontFamily: "'Space Mono',monospace" }}>CRCL VALUATION COMPUTER · DCA SIGNAL · {data.updated}</p>
        </div>

        {/* Hero: Score / Multiplier / Price — R2: auto-fit */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, padding: "22px 14px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: 3, fontFamily: "'Space Mono',monospace", marginBottom: 2 }}>DCA SCORE</div>
            <Ring score={composite} />
            <div style={{ display: "inline-block", marginTop: 4, background: C.orangeBg, border: "1px solid rgba(232,130,12,0.2)", borderRadius: 6, padding: "3px 12px" }}>
              <span style={{ color: C.orange, fontSize: 12, fontWeight: 700 }}>{labelOf(composite)}</span>
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "0 6px" }}>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: 3, fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>INVEST MULTIPLIER</div>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, fontFamily: "'Space Mono',monospace", color: risk.halted ? C.red : C.orange, textDecoration: risk.halted ? "line-through" : "none" }}>{mult}x</div>
            <div style={{ color: C.textSub, fontSize: 12, margin: "4px 0 10px" }}>{risk.halted ? "⛔ 风控熔断" : "今天建议定投倍数"}</div>
            <div style={{ background: "#f8f4ec", border: `1px solid ${C.cardBorder}`, borderRadius: 10, padding: "10px 12px" }}>
              <span style={{ color: C.text, fontSize: 12.5, lineHeight: 1.6 }}>
                综合评分 <b style={{ color: C.orange }}>{composite}</b> 分，{labelOf(composite)}。
                {risk.halted ? <span style={{ color: C.red }}> 风控触发，<b>暂停定投</b>。</span> : <> 建议 <b style={{ color: C.orange }}>{mult}x</b>（{composite >= 70 ? "增配" : composite >= 50 ? "正常" : "减配"}）。</>}
              </span>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: 3, fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>CRCL/USD</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: C.orange, fontFamily: "'Space Mono',monospace", lineHeight: 1 }}>${data.price}</div>
            <div style={{ color: data.priceChg >= 0 ? C.green : C.red, fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono',monospace", marginTop: 3 }}>{data.priceChg >= 0 ? "+" : ""}{data.priceChg}%</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
              {[{ l: "200D MA", v: `$${data.ma200}` }, { l: "偏离度", v: `${(((data.price - data.ma200) / data.ma200) * 100).toFixed(0)}%`, c: data.price < data.ma200 ? C.green : C.red }].map((x, i) => (
                <div key={i} style={{ background: "#f8f4ec", border: `1px solid ${C.cardBorder}`, borderRadius: 8, padding: "5px 8px" }}>
                  <div style={{ color: C.textMuted, fontSize: 9, fontFamily: "'Space Mono',monospace", letterSpacing: 1 }}>{x.l}</div>
                  <div style={{ color: x.c || C.text, fontSize: 15, fontWeight: 800, fontFamily: "'Space Mono',monospace", marginTop: 1 }}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Earnings */}
        {daysToER > 0 && daysToER <= 30 && (
          <div style={{ background: "#fff9ed", border: "1px solid #f0e0b0", borderRadius: 10, padding: "7px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#a08020", fontSize: 12 }}>📅 Q1'26 财报 — {data.nextER}</span>
            <span style={{ color: C.orange, fontSize: 18, fontWeight: 900, fontFamily: "'Space Mono',monospace" }}>{daysToER}天</span>
          </div>
        )}

        {/* R3: Risk Alerts */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, padding: "16px", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: "0 0 10px" }}>🛡️ 风控状态</h3>
          {risk.alerts.length > 0 ? risk.alerts.map((a, i) => (
            <div key={i} style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 4, background: a.action === "halt" ? "rgba(229,72,77,0.06)" : "rgba(232,130,12,0.06)", border: `1px solid ${a.action === "halt" ? "rgba(229,72,77,0.2)" : "rgba(232,130,12,0.2)"}`, fontSize: 12.5, color: a.action === "halt" ? C.red : C.text, fontWeight: a.action === "halt" ? 700 : 400 }}>
              {a.level} {a.msg}
            </div>
          )) : (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(34,160,107,0.06)", border: "1px solid rgba(34,160,107,0.2)", fontSize: 12.5, color: C.green }}>✅ 所有风控指标正常</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6, marginTop: 10 }}>
            {[
              { l: "持仓回撤", v: costBasis > 0 ? `${risk.drawdown.toFixed(1)}%` : "—", c: risk.drawdown <= -20 ? C.red : risk.drawdown < 0 ? C.textSub : C.green },
              { l: "今日建议", v: risk.halted ? "⛔暂停" : `$${risk.todayAmt}`, c: risk.halted ? C.red : C.orange },
              { l: "单周限额", v: `$${risk.weeklyMax}`, c: C.textSub },
            ].map((m, i) => (
              <div key={i} style={{ background: "#f8f4ec", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 1, fontFamily: "'Space Mono',monospace" }}>{m.l}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: m.c, fontFamily: "'Space Mono',monospace", marginTop: 1 }}>{m.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* DIMENSIONS */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: C.orange }} />
            <h2 style={{ fontSize: 19, fontWeight: 900, color: C.text }}>维度详情</h2>
          </div>
          <p style={{ color: C.textMuted, fontSize: 10, fontFamily: "'Space Mono',monospace", margin: "0 0 10px" }}>5 DIMENSION ANALYSIS · 5维度深度分析</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10 }}>
            {dimKeys.map(k => { const d = dims[k]; return <DimCard key={k} name={d.name} nameEn={d.en} weight={d.w} score={d.score} rawVal={d.raw} desc={d.desc} />; })}
            <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, padding: "14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ color: C.textMuted, fontSize: 10, fontFamily: "'Space Mono',monospace", letterSpacing: 2, marginBottom: 4 }}>RADAR CHART</div>
              <Radar dims={dims} />
            </div>
          </div>
        </div>

        {/* Calculator + R3 Risk Inputs */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, padding: "18px", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: "0 0 10px" }}>💰 定投计算器 + 风控参数</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              { label: "基础金额 ($)", value: base, set: setBase },
              { label: "持仓成本 ($)", value: costBasis, set: setCostBasis },
              { label: "仓位占比 (%)", value: positionPct, set: setPositionPct },
              { label: "总资产 ($)", value: totalAssets, set: setTotalAssets },
            ].map((f, i) => (
              <div key={i}>
                <label style={{ fontSize: 11, color: C.textSub, display: "block", marginBottom: 2 }}>{f.label}</label>
                <input type="number" value={f.value} onChange={e => f.set(Number(e.target.value) || 0)} style={{ width: "100%", padding: "7px 8px", borderRadius: 8, border: `1.5px solid ${C.cardBorder}`, fontSize: 14, fontWeight: 700, fontFamily: "'Space Mono',monospace", outline: "none", background: "#f8f4ec", color: C.text }} />
              </div>
            ))}
          </div>
          <div style={{ background: risk.halted ? "rgba(229,72,77,0.06)" : C.orangeBg, border: `2px solid ${risk.halted ? "rgba(229,72,77,0.2)" : "rgba(232,130,12,0.2)"}`, borderRadius: 12, padding: "12px", textAlign: "center" }}>
            <div style={{ color: C.textSub, fontSize: 10, letterSpacing: 1 }}>{risk.halted ? "⛔ 风控熔断" : "今日建议定投"}</div>
            <div style={{ fontSize: 30, fontWeight: 900, fontFamily: "'Space Mono',monospace", color: risk.halted ? C.red : C.orange }}>{risk.halted ? "$0" : `$${risk.todayAmt}`}</div>
            <div style={{ color: C.textSub, fontSize: 11, fontFamily: "monospace" }}>{risk.halted ? risk.alerts.find(a => a.action === "halt")?.msg : `$${base} × ${mult} = $${risk.todayAmt}`}</div>
          </div>
        </div>

        {/* Multiplier Map */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, padding: "18px", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: "0 0 2px" }}>🎯 0.1x–3.0x 倍数映射</h3>
          <p style={{ color: C.textSub, fontSize: 11, margin: "0 0 10px" }}>高分=低估=高倍数 · 低分=高估=低倍数</p>
          {[
            { min: 0, max: 30, m: "0.10x–0.30x", l: "高估区·观望", c: C.red, b: "rgba(229,72,77,0.04)" },
            { min: 30, max: 50, m: "0.30x–0.80x", l: "偏高估·减少", c: "#d97706", b: "rgba(217,119,6,0.04)" },
            { min: 50, max: 70, m: "0.80x–1.20x", l: "合理区·正常", c: "#888", b: "rgba(0,0,0,0.02)" },
            { min: 70, max: 85, m: "1.20x–2.00x", l: "低估区·增配", c: C.green, b: "rgba(34,160,107,0.04)" },
            { min: 85, max: 100, m: "2.00x–3.00x", l: "极度低估·重配", c: "#0a8a50", b: "rgba(10,138,80,0.06)" },
          ].map((r, i) => {
            const active = composite >= r.min && composite < (r.max === 100 ? 101 : r.max);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: 10, marginBottom: 3, background: active ? r.b : "transparent", border: active ? `2px solid ${r.c}25` : "1px solid transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 80 }}>
                  {active && <div style={{ width: 7, height: 7, borderRadius: "50%", background: r.c }} />}
                  <span style={{ color: active ? C.text : C.textMuted, fontSize: 12, fontFamily: "'Space Mono',monospace", fontWeight: active ? 700 : 400 }}>{r.min}–{r.max}</span>
                </div>
                <span style={{ color: active ? C.text : C.textMuted, fontSize: 12 }}>{r.l}</span>
                <span style={{ color: active ? r.c : C.textMuted, fontSize: 13, fontWeight: 800, fontFamily: "'Space Mono',monospace" }}>{r.m}</span>
              </div>
            );
          })}
        </div>

        {/* Risk Rules */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, padding: "18px", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: "0 0 10px" }}>📋 风控规则一览</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 6 }}>
            {[
              { i: "⚡", t: "限额控制", d: `单周 ≤ $${base * 3}` },
              { i: "🔴", t: "回撤熔断", d: "回撤≥30% → 暂停", active: risk.drawdown <= -30 },
              { i: "📊", t: "仓位上限", d: `CRCL≤20%（现${positionPct}%）`, active: positionPct >= 20 },
              { i: "📅", t: "财报脉冲", d: "财报后±10分" },
              { i: "⏰", t: "时间止损", d: "18个月未改善→认亏" },
              { i: "📉", t: "降档保护", d: "5日85+分→降至1.5x" },
            ].map((r, j) => (
              <div key={j} style={{ background: r.active ? "rgba(229,72,77,0.06)" : "#f8f4ec", border: r.active ? "1px solid rgba(229,72,77,0.2)" : "none", borderRadius: 10, padding: "9px 10px", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>{r.i}</span>
                <div><div style={{ color: r.active ? C.red : C.text, fontSize: 12, fontWeight: 700 }}>{r.t}</div><div style={{ color: C.textSub, fontSize: 11 }}>{r.d}</div></div>
              </div>
            ))}
          </div>
        </div>

        {/* Algo */}
        <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, padding: "18px", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: "0 0 8px" }}>📐 评分算法</h3>
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: "14px 16px", fontFamily: "'Space Mono',monospace", fontSize: 11.5, lineHeight: 2, overflowX: "auto" }}>
            <div style={{ color: "#666" }}>{"// "}CRCL DCA v3.0 Darwin</div>
            <div><span style={{ color: C.orange }}>Score</span> = <span style={{ color: "#4ec9b0" }}>估值(30%)</span> + <span style={{ color: "#4ec9b0" }}>USDC(25%)</span> + <span style={{ color: "#4ec9b0" }}>利率(20%)</span> + <span style={{ color: "#4ec9b0" }}>技术(15%)</span> + <span style={{ color: "#4ec9b0" }}>情绪(10%)</span></div>
            <div><span style={{ color: C.orange }}>Mult</span> = <span style={{ color: "#dcdcaa" }}>piecewise</span>(Score → <span style={{ color: "#ce9178" }}>[0.1x, 3.0x]</span>)</div>
            <div style={{ color: "#666", marginTop: 4 }}>{"// "}Risk gate</div>
            <div><span style={{ color: "#e5484d" }}>if</span> drawdown &gt;= 30% <span style={{ color: "#e5484d" }}>||</span> position &gt;= 20%: <span style={{ color: "#e5484d" }}>HALT</span></div>
          </div>
        </div>

        <div style={{ textAlign: "center", padding: "10px 0 28px", color: C.textMuted, fontSize: 10 }}>
          <p style={{ margin: "0 0 2px", color: "#c0a080" }}>⚠️ 不构成投资建议</p>
          <p style={{ margin: "0 0 2px", fontFamily: "'Space Mono',monospace" }}>v3.0 Darwin · R1数据面板 R2响应式 R3风控落地</p>
          <p style={{ margin: 0 }}>CRCL DCA by 刘阳</p>
        </div>
      </div>
    </div>
  );
}
