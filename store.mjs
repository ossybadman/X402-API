// Durable storage for prepaid API keys and call metrics.
// Backed by Redis when REDIS_URL is set; falls back to in-memory otherwise so
// local dev needs no services. The in-memory path loses everything on restart.
import { createClient } from 'redis';

const HOUR = 3600000;
const RECENT_CAP = 100;
const HOURLY_TTL = 172800; // 48h — the dashboard only plots the last 24h

// @t2000/serve runs the route handler BEFORE settling payment, so a key minted in
// the handler exists even when the payment then fails. Keys are therefore born
// `pending` and unusable, and only `activateKey` (called once settlement is
// confirmed) makes them spendable. Unclaimed pending keys expire quickly.
export const PENDING_TTL = 900; // 15 min
export const KEY_TTL = 30 * 24 * 3600; // 30 days once paid for

const hourKey = (t = Date.now()) => Math.floor(t / HOUR) * HOUR;
const newKeyId = () => `si_${crypto.randomUUID().replaceAll('-', '')}`;
// Keys are bearer tokens and /dashboard is unauthenticated, so only ever show a mask there.
const maskKey = (k) => `${k.slice(0, 7)}…${k.slice(-4)}`;

function memoryStore() {
  const keys = new Map();
  // Redis expires hashes for us; in memory we sweep lazily on read.
  const live = (k) => {
    const e = keys.get(k);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < Date.now()) {
      keys.delete(k);
      return null;
    }
    return e;
  };
  const routes = new Map();
  const hourly = new Map();
  const recent = [];
  let totals = { calls: 0, revenueUsdc: 0, keysIssued: 0 };
  const since = Date.now();

  return {
    backend: 'memory',
    async issueKey(payer, calls) {
      const apiKey = newKeyId();
      keys.set(apiKey, {
        remaining: calls,
        payer,
        createdAt: Date.now(),
        status: 'pending',
        expiresAt: Date.now() + PENDING_TTL * 1000,
      });
      return apiKey;
    },
    async activateKey(apiKey, digest) {
      const entry = keys.get(apiKey);
      if (!entry || entry.status === 'active') return false;
      entry.status = 'active';
      entry.digest = digest ?? null;
      entry.expiresAt = Date.now() + KEY_TTL * 1000;
      totals.keysIssued += 1;
      return true;
    },
    async consumeKey(apiKey) {
      const entry = live(apiKey);
      if (!entry) return { ok: false, reason: 'unknown' };
      if (entry.status && entry.status !== 'active') return { ok: false, reason: 'pending' };
      if (entry.remaining <= 0) return { ok: false, reason: 'exhausted' };
      entry.remaining -= 1;
      return { ok: true, remaining: entry.remaining, payer: entry.payer };
    },
    async keyStatus(apiKey) {
      const e = live(apiKey);
      return e
        ? { remaining: e.remaining, createdAt: e.createdAt, status: e.status, expiresAt: e.expiresAt }
        : null;
    },
    async listKeys() {
      return [...keys.entries()]
        .filter(([k]) => live(k))
        .map(([k, v]) => ({
          masked: maskKey(k),
          remaining: v.remaining,
          createdAt: v.createdAt,
          status: v.status,
          expiresAt: v.expiresAt,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async record(route, priceUsdc, payer, via, digest = null) {
      totals.calls += 1;
      totals.revenueUsdc += priceUsdc;
      const r = routes.get(route) ?? { calls: 0, revenueUsdc: 0 };
      r.calls += 1;
      r.revenueUsdc += priceUsdc;
      routes.set(route, r);
      const h = hourKey();
      const cur = hourly.get(h) ?? { calls: 0, revenueUsdc: 0 };
      cur.calls += 1;
      cur.revenueUsdc += priceUsdc;
      hourly.set(h, cur);
      for (const k of hourly.keys()) if (k < h - 24 * HOUR) hourly.delete(k);
      recent.unshift({ t: Date.now(), route, via, payer: payer ?? null, priceUsdc, digest });
      if (recent.length > RECENT_CAP) recent.pop();
    },
    async stats() {
      let creditsOutstanding = 0;
      for (const k of keys.values()) creditsOutstanding += k.remaining;
      const h = hourKey();
      return {
        since,
        totals: { ...totals, creditsOutstanding, activeKeys: keys.size },
        routes: Object.fromEntries(
          [...routes].map(([p, r]) => [p, { calls: r.calls, revenueUsdc: +r.revenueUsdc.toFixed(2) }]),
        ),
        hourly: Array.from({ length: 24 }, (_, i) => {
          const hour = h - (23 - i) * HOUR;
          const v = hourly.get(hour) ?? { calls: 0, revenueUsdc: 0 };
          return { hour, calls: v.calls, revenueUsdc: +v.revenueUsdc.toFixed(2) };
        }),
        recent: recent.slice(0, 25),
      };
    },
  };
}

function redisStore(client) {
  return {
    backend: 'redis',
    async issueKey(payer, calls) {
      const apiKey = newKeyId();
      await client
        .multi()
        .hSet(`key:${apiKey}`, {
          remaining: String(calls),
          payer: payer ?? '',
          createdAt: String(Date.now()),
          status: 'pending',
        })
        .expire(`key:${apiKey}`, PENDING_TTL)
        .sAdd('keys:all', apiKey)
        .exec();
      return apiKey;
    },
    async activateKey(apiKey, digest) {
      const status = await client.hGet(`key:${apiKey}`, 'status');
      if (status !== 'pending') return false; // gone, or already activated
      await client
        .multi()
        .hSet(`key:${apiKey}`, { status: 'active', digest: digest ?? '' })
        .expire(`key:${apiKey}`, KEY_TTL)
        .incr('m:keysIssued')
        .exec();
      return true;
    },
    async consumeKey(apiKey) {
      if (!(await client.exists(`key:${apiKey}`))) return { ok: false, reason: 'unknown' };
      // Keys issued before the pending/active split carry no status; treat them as active.
      const status = await client.hGet(`key:${apiKey}`, 'status');
      if (status && status !== 'active') return { ok: false, reason: 'pending' };
      // HINCRBY is atomic, so concurrent calls can't both spend the last credit.
      const remaining = await client.hIncrBy(`key:${apiKey}`, 'remaining', -1);
      if (remaining < 0) {
        await client.hIncrBy(`key:${apiKey}`, 'remaining', 1);
        return { ok: false, reason: 'exhausted' };
      }
      return { ok: true, remaining, payer: (await client.hGet(`key:${apiKey}`, 'payer')) || null };
    },
    async keyStatus(apiKey) {
      const [h, ttl] = await Promise.all([client.hGetAll(`key:${apiKey}`), client.ttl(`key:${apiKey}`)]);
      if (!h || h.remaining === undefined) return null;
      return {
        remaining: Number(h.remaining),
        createdAt: Number(h.createdAt),
        status: h.status ?? 'active',
        expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
      };
    },
    async listKeys() {
      const ids = await client.sMembers('keys:all');
      const rows = await Promise.all(
        ids.map(async (k) => [k, await client.hGetAll(`key:${k}`), await client.ttl(`key:${k}`)]),
      );
      // Expired hashes leave stale members behind in the set; drop them as we see them.
      const dead = rows.filter(([, h]) => !h || h.remaining === undefined).map(([k]) => k);
      if (dead.length) await client.sRem('keys:all', dead);
      return rows
        .filter(([, h]) => h && h.remaining !== undefined)
        .map(([k, h, ttl]) => ({
          masked: maskKey(k),
          remaining: Number(h.remaining),
          createdAt: Number(h.createdAt),
          status: h.status ?? 'active',
          expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async record(route, priceUsdc, payer, via, digest = null) {
      const h = hourKey();
      await client
        .multi()
        .incr('m:calls')
        .incrByFloat('m:revenue', priceUsdc)
        .incr(`m:route:${route}:calls`)
        .incrByFloat(`m:route:${route}:revenue`, priceUsdc)
        .incr(`m:hour:${h}:calls`)
        .incrByFloat(`m:hour:${h}:revenue`, priceUsdc)
        .expire(`m:hour:${h}:calls`, HOURLY_TTL)
        .expire(`m:hour:${h}:revenue`, HOURLY_TTL)
        .lPush('m:recent', JSON.stringify({ t: Date.now(), route, via, payer: payer ?? null, priceUsdc, digest }))
        .lTrim('m:recent', 0, RECENT_CAP - 1)
        .sAdd('m:routes', route)
        .exec();
    },
    async stats() {
      const h = hourKey();
      const hours = Array.from({ length: 24 }, (_, i) => h - (23 - i) * HOUR);
      const routeNames = await client.sMembers('m:routes');
      const [calls, revenue, keysIssued, since, recentRaw, keyIds] = await Promise.all([
        client.get('m:calls'),
        client.get('m:revenue'),
        client.get('m:keysIssued'),
        client.get('m:since'),
        client.lRange('m:recent', 0, 24),
        client.sMembers('keys:all'),
      ]);
      const hourVals = await Promise.all(
        hours.map((hour) => Promise.all([client.get(`m:hour:${hour}:calls`), client.get(`m:hour:${hour}:revenue`)])),
      );
      const routeVals = await Promise.all(
        routeNames.map((p) =>
          Promise.all([client.get(`m:route:${p}:calls`), client.get(`m:route:${p}:revenue`)]),
        ),
      );
      // Sum outstanding credits across live keys; keys are few, so a per-key read is fine.
      const remainings = await Promise.all(keyIds.map((k) => client.hGet(`key:${k}`, 'remaining')));
      const creditsOutstanding = remainings.reduce((a, v) => a + Math.max(0, Number(v) || 0), 0);
      return {
        since: Number(since) || Date.now(),
        totals: {
          calls: Number(calls) || 0,
          revenueUsdc: +(Number(revenue) || 0).toFixed(2),
          keysIssued: Number(keysIssued) || 0,
          creditsOutstanding,
          activeKeys: keyIds.length,
        },
        routes: Object.fromEntries(
          routeNames.map((p, i) => [
            p,
            { calls: Number(routeVals[i][0]) || 0, revenueUsdc: +(Number(routeVals[i][1]) || 0).toFixed(2) },
          ]),
        ),
        hourly: hours.map((hour, i) => ({
          hour,
          calls: Number(hourVals[i][0]) || 0,
          revenueUsdc: +(Number(hourVals[i][1]) || 0).toFixed(2),
        })),
        recent: recentRaw.map((s) => JSON.parse(s)),
      };
    },
  };
}

export async function createStore(url = process.env.REDIS_URL) {
  if (!url) {
    console.warn('[store] No REDIS_URL — using in-memory store; keys and metrics reset on restart.');
    return memoryStore();
  }
  try {
    const client = createClient({ url });
    client.on('error', (e) => console.error('[store] redis error:', e.message));
    await client.connect();
    await client.setNX('m:since', String(Date.now()));
    console.log('[store] connected to Redis — keys and metrics are durable.');
    return redisStore(client);
  } catch (e) {
    console.error(`[store] Redis unavailable (${e.message}) — falling back to in-memory.`);
    return memoryStore();
  }
}
