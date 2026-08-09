// Call metrics for the seller dashboard, stored in the same Upstash KV that backs
// the replay store. Talks the Upstash REST protocol directly, so there is no extra
// dependency and it works from a serverless function with no TCP connection.
//
// Only settled calls are recorded. The handler runs before payment settles, so
// recording there would count unpaid attempts; see app/inspect/route.ts.

const URL_BASE = process.env.KV_REST_API_URL?.replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN;

export const metricsEnabled = Boolean(URL_BASE && TOKEN);

const HOUR = 3600000;
const RECENT_CAP = 50;
const HOURLY_TTL = 172800; // 48h, twice what the dashboard plots

export type Call = {
  t: number;
  payer: string | null;
  priceUsdc: number;
  digest: string | null;
};

async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  if (!metricsEnabled) return [];
  const res = await fetch(`${URL_BASE}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash pipeline failed: ${res.status}`);
  const body = (await res.json()) as ({ result?: unknown; error?: string } | unknown)[];
  return body.map((r) => (r && typeof r === 'object' && 'result' in r ? r.result : r));
}

const hourKey = (t = Date.now()) => Math.floor(t / HOUR) * HOUR;

/** Record one settled, paid call. Never throws into the request path. */
export async function recordCall(call: Call): Promise<void> {
  if (!metricsEnabled) return;
  const h = hourKey(call.t);
  try {
    await pipeline([
      ['INCR', 'm:calls'],
      ['INCRBYFLOAT', 'm:revenue', call.priceUsdc],
      ['INCR', `m:hour:${h}:calls`],
      ['EXPIRE', `m:hour:${h}:calls`, HOURLY_TTL],
      ['INCRBYFLOAT', `m:hour:${h}:revenue`, call.priceUsdc],
      ['EXPIRE', `m:hour:${h}:revenue`, HOURLY_TTL],
      ['LPUSH', 'm:recent', JSON.stringify(call)],
      ['LTRIM', 'm:recent', 0, RECENT_CAP - 1],
      ['SETNX', 'm:since', String(call.t)],
      ...(call.payer ? [['SADD', 'm:payers', call.payer]] : []),
    ]);
  } catch (err) {
    // Analytics must never affect a buyer who has already paid and been served.
    console.error('[metrics] record failed:', (err as Error).message);
  }
}

export type Stats = {
  enabled: boolean;
  since: number | null;
  totals: { calls: number; revenueUsdc: number; payers: number };
  hourly: { hour: number; calls: number; revenueUsdc: number }[];
  recent: Call[];
};

export async function readStats(): Promise<Stats> {
  const now = hourKey();
  const hours = Array.from({ length: 24 }, (_, i) => now - (23 - i) * HOUR);

  if (!metricsEnabled) {
    return {
      enabled: false,
      since: null,
      totals: { calls: 0, revenueUsdc: 0, payers: 0 },
      hourly: hours.map((hour) => ({ hour, calls: 0, revenueUsdc: 0 })),
      recent: [],
    };
  }

  try {
    const out = await pipeline([
      ['GET', 'm:calls'],
      ['GET', 'm:revenue'],
      ['GET', 'm:since'],
      ['SCARD', 'm:payers'],
      ['LRANGE', 'm:recent', 0, RECENT_CAP - 1],
      ...hours.flatMap((h) => [
        ['GET', `m:hour:${h}:calls`],
        ['GET', `m:hour:${h}:revenue`],
      ]),
    ]);

    const [calls, revenue, since, payers, recentRaw, ...hourVals] = out;
    const num = (v: unknown) => Number(v ?? 0) || 0;

    return {
      enabled: true,
      since: since ? Number(since) : null,
      totals: {
        calls: num(calls),
        revenueUsdc: +num(revenue).toFixed(4),
        payers: num(payers),
      },
      hourly: hours.map((hour, i) => ({
        hour,
        calls: num(hourVals[i * 2]),
        revenueUsdc: +num(hourVals[i * 2 + 1]).toFixed(4),
      })),
      recent: ((recentRaw as string[]) ?? []).map((s) =>
        typeof s === 'string' ? (JSON.parse(s) as Call) : (s as Call),
      ),
    };
  } catch (err) {
    console.error('[metrics] read failed:', (err as Error).message);
    return {
      enabled: false,
      since: null,
      totals: { calls: 0, revenueUsdc: 0, payers: 0 },
      hourly: hours.map((hour) => ({ hour, calls: 0, revenueUsdc: 0 })),
      recent: [],
    };
  }
}
