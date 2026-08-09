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

// Palette matches the storefront so the two pages read as one product.
const BG = '#0a0a0a';
const CARD = '#0e0e0e';
const EDGE = '#1f1f1f';
const HAIR = '#1a1a1a';
const INK = '#ededed';
const INK2 = '#a1a1a1';
const INK3 = '#8f8f8f';
const INK4 = '#666';
const AMBER = '#e2c07e';
// Chart marks are held to a stricter bar than UI chrome: this hue is validated for
// lightness band, chroma floor, and contrast against the surface above. The
// storefront's lighter blue and green fail those checks as data colours.
const SERIES = '#3987e5';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const hourLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit' });
const exact = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour12: false })}`;
};

function Chart({ hourly }: { hourly: Hour[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 900;
  const H = 200;
  const padL = 30;
  const padB = 24;
  const padT = 18;
  const max = Math.max(1, ...hourly.map((h) => h.calls));
  const iw = (W - padL) / 24;
  const bw = Math.max(4, iw - 3); // surface gap between adjacent bars
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const peak = hourly.reduce((a, b) => (b.calls > a.calls ? b : a), hourly[0]);
  const empty = max === 1 && hourly.every((h) => h.calls === 0);

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        role="img"
        aria-label="Paid calls per hour, last 24 hours"
      >
        {(max >= 2 ? [0, 0.5, 1] : [0, 1]).map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke={HAIR} strokeWidth={1} />
            <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" fill={INK4} fontSize={10.5} fontFamily={mono}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {hourly.map((h, i) => {
          const x = padL + i * iw + 1.5;
          const top = y(h.calls);
          const bh = y(0) - top;
          const r = Math.min(4, bh); // rounded data end, anchored to the baseline
          return (
            <g key={h.hour}>
              {h.calls > 0 && (
                <path
                  fill={SERIES}
                  d={`M${x} ${top + r} q0 -${r} ${r} -${r} h${bw - 2 * r} q${r} 0 ${r} ${r} v${Math.max(0, bh - r)} h-${bw} Z`}
                />
              )}
              {h.calls > 0 && h === peak && (
                <text x={x + bw / 2} y={top - 6} textAnchor="middle" fill={INK2} fontSize={10.5} fontFamily={mono}>
                  {h.calls}
                </text>
              )}
              {i % 6 === 0 && (
                <text x={x + bw / 2} y={H - 7} textAnchor="middle" fill={INK4} fontSize={10.5} fontFamily={mono}>
                  {hourLabel(h.hour)}
                </text>
              )}
              <rect
                x={x - 1.5}
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
      {empty && (
        <p style={{ color: INK4, fontSize: 12.5, margin: '4px 0 0', textAlign: 'center' }}>
          No paid calls in the last 24 hours
        </p>
      )}
      {tip && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 200),
            top: tip.y - 38,
            background: '#161616',
            border: `1px solid ${EDGE}`,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: mono,
            color: INK,
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,.5)',
          }}
        >
          {tip.text}
        </div>
      )}
    </>
  );
}

const sectionLabel = {
  fontSize: 13,
  fontWeight: 600,
  color: INK3,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  margin: '0 0 12px',
};

const panel = {
  background: CARD,
  border: `1px solid ${EDGE}`,
  borderRadius: 12,
  padding: '18px 20px',
  overflowX: 'auto' as const,
};

const th = {
  textAlign: 'left' as const,
  color: INK4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  padding: '0 12px 10px 0',
  whiteSpace: 'nowrap' as const,
};
const td = {
  padding: '11px 12px 11px 0',
  borderTop: `1px solid ${HAIR}`,
  fontSize: 13,
  whiteSpace: 'nowrap' as const,
};

export default function Dashboard() {
  const [d, setD] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);

  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setD(await (await fetch('/stats.json', { cache: 'no-store' })).json());
      setFetchedAt(Date.now());
      setErr(false);
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    // Separate beat so the freshness label ages between fetches.
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  const age = fetchedAt == null ? null : Math.floor((Date.now() - fetchedAt) / 1000);
  const updatedLabel =
    age == null ? 'loading' : age < 5 ? 'up to date' : age < 60 ? `updated ${age}s ago` : `updated ${Math.floor(age / 60)}m ago`;

  // A pill that says something normal on every load is noise. This one reports how
  // fresh the numbers are, and only raises its voice when they cannot be trusted.
  const broken = err || d?.enabled === false;
  const status =
    d == null ? 'loading' : err ? 'connection lost' : d.enabled ? updatedLabel : 'metrics offline';

  const tiles = [
    { k: 'Revenue', v: usd(d?.totals.revenueUsdc), s: 'USDC settled on chain' },
    { k: 'Paid calls', v: d ? String(d.totals.calls) : '—', s: 'settlements recorded' },
    { k: 'Unique payers', v: d ? String(d.totals.payers) : '—', s: 'distinct addresses' },
    { k: 'Wallet USDC', v: usd(d?.onchainUsdc), s: 'live balance of payTo' },
  ];

  return (
    <main style={{ maxWidth: 940, margin: '0 auto', padding: '0 28px 80px', color: INK, background: BG }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '22px 0',
          borderBottom: `1px solid ${EDGE}`,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: INK,
              color: BG,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: mono,
            }}
          >
            $
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{d?.service ?? 'Sui Address Inspector'}</span>
          <span style={{ fontSize: 13, color: INK4 }}>revenue</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <a href="/" style={{ fontSize: 12.5, color: INK2, textDecoration: 'none' }}>
            View public page
          </a>
          <span
            style={{
              fontSize: 11.5,
              fontFamily: mono,
              color: broken ? AMBER : INK3,
              border: `1px solid ${broken ? '#3a2f1f' : EDGE}`,
              background: broken ? '#1a1408' : 'transparent',
              borderRadius: 999,
              padding: '4px 10px',
            }}
            title={
              broken
                ? 'Figures below may be stale or incomplete'
                : 'Figures refresh every 15 seconds'
            }
          >
            {status}
          </span>
        </div>
      </header>

      <section style={{ padding: '36px 0 0' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 12,
          }}
        >
          {tiles.map((t) => (
            <div key={t.k} style={{ ...panel, padding: '16px 18px' }}>
              <p style={{ color: INK4, fontSize: 11, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                {t.k}
              </p>
              <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.05, fontFamily: mono, letterSpacing: '-0.02em' }}>
                {t.v}
              </div>
              <div style={{ color: INK4, fontSize: 12, marginTop: 8 }}>{t.s}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={sectionLabel}>Paid calls per hour, last 24 h</h2>
        <div style={panel}>
          {d ? <Chart hourly={d.hourly} /> : <div style={{ color: INK4, fontSize: 13, padding: '60px 0', textAlign: 'center' }}>Loading</div>}
        </div>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={sectionLabel}>Recent paid calls</h2>
        <div style={panel}>
          {d && d.recent.length > 0 ? (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Payer</th>
                  <th style={{ ...th, textAlign: 'right', paddingRight: 24 }}>USDC</th>
                  <th style={th}>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((c, i) => (
                  <tr key={`${c.digest ?? i}-${c.t}`}>
                    <td style={{ ...td, color: INK2, fontFamily: mono, fontSize: 12.5 }}>{exact(c.t)}</td>
                    <td style={{ ...td, fontFamily: mono, fontSize: 12.5, color: INK2 }} title={c.payer ?? ''}>
                      {short(c.payer)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: mono, paddingRight: 24 }}>{usd(c.priceUsdc)}</td>
                    <td style={{ ...td, fontFamily: mono, fontSize: 12.5 }}>
                      {c.digest ? (
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${c.digest}`}
                          target="_blank"
                          rel="noopener"
                          style={{ color: SERIES, textDecoration: 'none' }}
                          title={c.digest}
                        >
                          {c.digest.slice(0, 10)}…
                        </a>
                      ) : (
                        <span style={{ color: INK4 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: INK4, fontSize: 13, textAlign: 'center', padding: '44px 0' }}>
              {d ? 'No paid calls yet. The first settlement will appear here with its Suiscan link.' : 'Loading'}
            </div>
          )}
        </div>
        {d?.since && (
          <p style={{ color: INK4, fontSize: 12, margin: '14px 0 0' }}>
            Recording since {new Date(d.since).toLocaleString()}. Only settled payments are counted, so
            unpaid attempts and failed handlers never appear.
          </p>
        )}
      </section>
    </main>
  );
}
