'use client';

import { useCallback, useEffect, useState } from 'react';

type Call = { t: number; payer: string | null; priceUsdc: number; digest: string | null };
type Hour = { hour: number; calls: number; revenueUsdc: number };
type Stats = {
  service?: string;
  payTo?: string;
  onchainUsdc: number | null;
  enabled: boolean;
  since: number | null;
  totals: { calls: number; revenueUsdc: number; payers: number };
  hourly: Hour[];
  recent: Call[];
};

// Series colour validated for lightness band, chroma floor, and contrast against
// the dark chart surface. One series, so no legend is needed; the title names it.
const SERIES = '#3987e5';
const INK = '#e8e8e6';
const INK2 = '#a8adb6';
const INK3 = '#7c828c';
const LINE = '#33353d';
const CARD = '#1a1f26';

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const short = (a: string | null) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—');
const hourLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit' });
const exact = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour12: false })}`;
};

function Chart({ hourly }: { hourly: Hour[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 900;
  const H = 220;
  const padL = 34;
  const padB = 22;
  const padT = 14;
  const max = Math.max(1, ...hourly.map((h) => h.calls));
  const iw = (W - padL) / 24;
  const bw = Math.max(4, iw - 2); // 2px surface gap between adjacent bars
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const peak = hourly.reduce((a, b) => (b.calls > a.calls ? b : a), hourly[0]);

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}
        role="img" aria-label="Calls per hour, last 24 hours">
        {(max >= 2 ? [0, 0.5, 1] : [0, 1]).map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke={LINE} strokeWidth={1} />
            <text x={padL - 6} y={y(max * f) + 4} textAnchor="end" fill={INK3} fontSize={11}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {hourly.map((h, i) => {
          const x = padL + i * iw + 1;
          const top = y(h.calls);
          const bh = y(0) - top;
          const r = Math.min(4, bh); // 4px rounded data end, anchored to the baseline
          return (
            <g key={h.hour}>
              {h.calls > 0 && (
                <path
                  fill={SERIES}
                  d={`M${x} ${top + r} q0 -${r} ${r} -${r} h${bw - 2 * r} q${r} 0 ${r} ${r} v${Math.max(0, bh - r)} h-${bw} Z`}
                />
              )}
              {h.calls > 0 && h === peak && (
                <text x={x + bw / 2} y={top - 5} textAnchor="middle" fill={INK2} fontSize={11}>
                  {h.calls}
                </text>
              )}
              {i % 4 === 0 && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fill={INK3} fontSize={11}>
                  {hourLabel(h.hour)}
                </text>
              )}
              <rect
                x={x - 1}
                y={0}
                width={iw}
                height={H}
                fill="transparent"
                onMouseMove={(e) =>
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    text: `${hourLabel(h.hour)} · ${h.calls} call${h.calls === 1 ? '' : 's'}${h.revenueUsdc ? ` · ${usd(h.revenueUsdc)}` : ''}`,
                  })
                }
                onMouseLeave={() => setTip(null)}
              />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(tip.x + 12, 1200),
            top: tip.y - 34,
            background: CARD,
            border: `1px solid ${LINE}`,
            borderRadius: 6,
            padding: '.35rem .6rem',
            fontSize: 12.5,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {tip.text}
        </div>
      )}
    </>
  );
}

const card = {
  background: CARD,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: '1.1rem 1.25rem',
  marginBottom: '1.25rem',
  overflowX: 'auto' as const,
};
const th = {
  textAlign: 'left' as const,
  color: INK2,
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
  padding: '.35rem .6rem',
};
const td = { padding: '.4rem .6rem', borderTop: `1px solid ${LINE}`, fontSize: 13.5 };

export default function Dashboard() {
  const [d, setD] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await (await fetch('/stats.json', { cache: 'no-store' })).json());
      setErr(false);
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const tiles = [
    { k: 'Revenue', v: usd(d?.totals.revenueUsdc), s: 'USDC settled' },
    { k: 'Paid calls', v: d?.totals.calls ?? '—', s: 'settled on chain' },
    { k: 'Unique payers', v: d?.totals.payers ?? '—', s: 'distinct addresses' },
    { k: 'Wallet USDC', v: usd(d?.onchainUsdc), s: 'live balance of payTo' },
  ];

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2.5rem 1.25rem 4rem', color: INK }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{d?.service ?? 'Sui Address Inspector'}</h1>
        <span style={{ color: INK3, fontSize: 13 }}>
          {d?.enabled === false ? 'metrics store unavailable' : 'durable'}
          {d?.since ? ` · since ${new Date(d.since).toLocaleDateString()}` : ''}
          {err ? ' · fetch failed, retrying' : ''}
        </span>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.9rem', marginBottom: '1.5rem' }}>
        {tiles.map((t) => (
          <div key={t.k} style={{ ...card, marginBottom: 0 }}>
            <p style={{ color: INK2, fontSize: 12.5, margin: '0 0 .35rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t.k}</p>
            <div style={{ fontSize: '1.7rem', fontWeight: 650, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{t.v}</div>
            <div style={{ color: INK3, fontSize: 12.5, marginTop: '.3rem' }}>{t.s}</div>
          </div>
        ))}
      </div>

      <section style={card}>
        <h2 style={{ fontSize: 15, margin: '0 0 .75rem', fontWeight: 600 }}>Paid calls per hour, last 24 h</h2>
        {d ? <Chart hourly={d.hourly} /> : <div style={{ color: INK3 }}>Loading</div>}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 15, margin: '0 0 .75rem', fontWeight: 600 }}>Recent paid calls</h2>
        {d && d.recent.length > 0 ? (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Payer</th>
                <th style={{ ...th, textAlign: 'right' }}>USDC</th>
                <th style={th}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((c, i) => (
                <tr key={`${c.digest ?? i}-${c.t}`}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{exact(c.t)}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} title={c.payer ?? ''}>{short(c.payer)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{usd(c.priceUsdc)}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
                    {c.digest ? (
                      <a href={`https://suiscan.xyz/mainnet/tx/${c.digest}`} target="_blank" rel="noopener" style={{ color: SERIES }} title={c.digest}>
                        {c.digest.slice(0, 8)}…
                      </a>
                    ) : (
                      <span style={{ color: INK3 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: INK3, textAlign: 'center', padding: '1.5rem 0' }}>No paid calls yet.</div>
        )}
      </section>
    </main>
  );
}
