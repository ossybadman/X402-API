import { readFile } from 'node:fs/promises';
import { serve as listen } from '@hono/node-server';
import { createStore } from './store.mjs';
import { Hono } from 'hono';
import { createServeFromEnv } from '@t2000/serve';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';

const sui = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443',
});

const input = z.object({
  address: z
    .string()
    .describe('Sui address to inspect (0x-prefixed, mainnet)')
    .refine((a) => isValidSuiAddress(a), 'not a valid Sui address'),
  apiKey: z
    .string()
    .describe('Optional prepaid key from POST /keys — supply it to spend a credit instead of paying')
    .optional(),
});

const output = z.object({
  address: z.string(),
  suiBalance: z.string().describe('Total SUI in human units'),
  balances: z.array(
    z.object({
      coinType: z.string(),
      symbol: z.string(),
      decimals: z.number().nullable(),
      balance: z.string().describe('Raw base-unit balance'),
      humanBalance: z.string().describe('Balance adjusted for decimals'),
    }),
  ),
  objects: z.object({
    sampledCount: z.number().describe('Objects counted (first 50)'),
    hasMore: z.boolean(),
    stakedSuiObjects: z.number().describe('StakedSui objects in the sample'),
    topTypes: z.array(z.object({ type: z.string(), count: z.number() })),
  }),
  inspectedAtEpoch: z.string(),
});

const SUI_TYPE_SUFFIX = '::sui::SUI';
const STAKED_SUI_SUFFIX = '::staking_pool::StakedSui';

async function inspect(address) {
  const addr = normalizeSuiAddress(address);
  const [balancePage, objectsPage, sys] = await Promise.all([
    sui.listBalances({ owner: addr }),
    sui.listOwnedObjects({ owner: addr, limit: 50 }),
    sui.core.getCurrentSystemState(),
  ]);

  const balances = await Promise.all(
    balancePage.balances.map(async (b) => {
      let symbol = b.coinType.split('::').pop() ?? b.coinType;
      let decimals = null;
      try {
        const meta = await sui.getCoinMetadata({ coinType: b.coinType });
        if (meta?.coinMetadata) {
          symbol = meta.coinMetadata.symbol || symbol;
          decimals = meta.coinMetadata.decimals ?? null;
        }
      } catch {
        // metadata is optional — raw balance is still reported
      }
      const raw = String(b.balance);
      return {
        coinType: b.coinType,
        symbol,
        decimals,
        balance: raw,
        humanBalance: decimals == null ? raw : (Number(raw) / 10 ** decimals).toString(),
      };
    }),
  );

  const suiRaw =
    balancePage.balances.find((b) => b.coinType.endsWith(SUI_TYPE_SUFFIX))?.balance ?? 0n;

  const typeCounts = new Map();
  let stakedSuiObjects = 0;
  for (const o of objectsPage.objects) {
    const t = o.type ?? 'unknown';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    if (t.endsWith(STAKED_SUI_SUFFIX)) stakedSuiObjects += 1;
  }
  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));

  return {
    address: addr,
    suiBalance: (Number(suiRaw) / 1e9).toString(),
    balances,
    objects: {
      sampledCount: objectsPage.objects.length,
      hasMore: objectsPage.hasNextPage,
      stakedSuiObjects,
      topTypes,
    },
    inspectedAtEpoch: String(sys.systemState?.epoch ?? sys.epoch ?? ''),
  };
}

const serve = createServeFromEnv({
  T2000_PAY_TO: '0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b',
  T2000_NAME: 'Sui Address Inspector',
  T2000_DESCRIPTION:
    'Balances, objects, and stakes for any Sui mainnet address — paid per call in USDC via x402.',
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)),
});

// Prepaid keys + call metrics live here; durable when REDIS_URL is set.
const store = await createStore();
const bootedAt = Date.now();

const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
let balanceCache = { at: 0, usdc: null };
async function payToUsdcBalance() {
  if (Date.now() - balanceCache.at < 30000) return balanceCache.usdc;
  try {
    const b = await sui.getBalance({ owner: serve.payTo, coinType: USDC_TYPE });
    const raw = b?.balance?.balance ?? b?.balance ?? 0n;
    balanceCache = { at: Date.now(), usdc: Number(raw) / 1e6 };
  } catch {
    balanceCache = { at: Date.now(), usdc: balanceCache.usdc };
  }
  return balanceCache.usdc;
}

// --- Prepaid API keys: pay once via x402, then call with Authorization: Bearer <key>.
const KEY_PRICE = '0.10';
const KEY_CALLS = 12;

const keyOutput = z.object({
  apiKey: z.string(),
  calls: z.number(),
  usage: z.string(),
});

serve
  .route({
    path: 'keys',
    description: `Buy a prepaid API key: one ${KEY_PRICE} USDC payment grants ${KEY_CALLS} /inspect calls. Spend it by putting the key in the /inspect body as "apiKey", or as an "Authorization: Bearer <key>" header — either way those calls cost nothing further.`,
  })
  .paid(KEY_PRICE)
  .response(z.toJSONSchema(keyOutput))
  .handler(async ({ payer }) => {
    const apiKey = await store.issueKey(payer, KEY_CALLS);
    return {
      apiKey,
      calls: KEY_CALLS,
      usage:
        'POST /inspect with {"address":"0x...","apiKey":"<apiKey>"} in the body — works anywhere you can send JSON, including the t2000 try-it dialog. From code you can instead send an "Authorization: Bearer <apiKey>" header. Either way no payment is taken.',
    };
  });

serve
  .route({
    path: 'inspect',
    description:
      'Inspect any Sui mainnet address: coin balances (with symbols and human units), owned-object profile, staking snapshot, current epoch. Holders of a prepaid key from POST /keys can add "apiKey" to the body to spend a credit instead of paying.',
  })
  .paid('0.01')
  .body(input, z.toJSONSchema(input))
  .response(z.toJSONSchema(output))
  .handler(async ({ body, payer }) => {
    return inspect(body.address);
  });

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, service: serve.name ?? 'sui-inspector-x402' }));

app.get('/', (c) => {
  const origin = new URL(c.req.url).origin;
  const base = serve.baseUrl || origin;
  const routes = [...serve.routes.values()].map((r) => r.meta);
  const rows = routes
    .map(
      (m) => `<tr><td><code>POST /${m.path}</code></td><td>$${m.priceUsdc ?? '0'} USDC</td><td>${m.description ?? ''}</td></tr>`,
    )
    .join('');
  return c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${serve.name ?? 'x402 API'}</title>
<style>
  :root{color-scheme:light dark;--fg:#1a1d21;--bg:#fafafa;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--acc:#0b7285}
  @media (prefers-color-scheme:dark){:root{--fg:#e6e6e6;--bg:#111418;--mut:#9aa4b2;--card:#1a1f26;--line:#2a313b;--acc:#66d9e8}}
  body{margin:0;font:16px/1.6 system-ui,sans-serif;color:var(--fg);background:var(--bg)}
  main{max-width:760px;margin:0 auto;padding:3rem 1.25rem}
  h1{font-size:1.6rem;margin:0 0 .25rem}
  .sub{color:var(--mut);margin:0 0 2rem}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.25rem;margin:0 0 1.25rem;overflow-x:auto}
  table{border-collapse:collapse;width:100%}
  td{padding:.4rem .6rem;border-top:1px solid var(--line);vertical-align:top}
  tr:first-child td{border-top:0}
  code,pre{font:13px/1.5 ui-monospace,Consolas,monospace}
  pre{margin:0;white-space:pre-wrap;word-break:break-all}
  a{color:var(--acc)}
  .k{color:var(--mut)}
  h2{font-size:1.05rem;margin:1.5rem 0 .5rem}
</style></head><body><main>
<h1>${serve.name ?? 'x402 API'}</h1>
<p class="sub">${serve.description ?? ''}</p>
<div class="card"><table>${rows}</table></div>
<h2>Pay per call (x402, USDC on Sui mainnet)</h2>
<div class="card"><pre>t2 pay ${base}/inspect --data '{"address":"0x..."}' --max-price 0.05</pre></div>
<h2>Or prepay once</h2>
<p class="k">Buy a key with <code>POST /keys</code> ($${KEY_PRICE}, ${KEY_CALLS} calls), then spend credits by
putting it in the body &mdash; which works anywhere you can send JSON, including the t2000 try-it dialog:</p>
<div class="card"><pre>{"address": "0x...", "apiKey": "si_..."}</pre></div>
<p class="k">From code, an <code>Authorization: Bearer si_...</code> header does the same thing.
Responses carry <code>X-Key-Calls-Remaining</code>.</p>
<p class="k">Unpaid requests answer HTTP 402 with a signed Sui challenge. Invalid input is rejected
before settlement &mdash; a failed call is never charged. Settles to
<code>${serve.payTo}</code>.</p>
<h2>Machine discovery</h2>
<p><a href="/dashboard">dashboard</a> &middot; <a href="/openapi.json">openapi.json</a> &middot; <a href="/llms.txt">llms.txt</a> &middot;
<a href="https://t2000.ai/${serve.payTo}">t2000 store listing</a></p>
</main></body></html>`);
});

app.get('/stats.json', async (c) => {
  const s = await store.stats();
  return c.json({
    service: serve.name,
    payTo: serve.payTo,
    bootedAt,
    durable: store.backend === 'redis',
    since: s.since,
    totals: s.totals,
    onchainUsdc: await payToUsdcBalance(),
    routes: s.routes,
    hourly: s.hourly,
    recent: s.recent,
  });
});

const DASHBOARD_HTML = await readFile(new URL('./dashboard.html', import.meta.url), 'utf8');
app.get('/dashboard', (c) => c.html(DASHBOARD_HTML));

// Prepaid-key path: a valid key skips the x402 payment flow entirely. The key may
// arrive as a Bearer header (code) or as an `apiKey` body field — the t2000 try-it
// modal can only set a body, so body support is what makes a key usable there.
app.post('/inspect', async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const headerKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  // Read from a clone so the untouched original still reaches the x402 layer.
  let body = null;
  try {
    const text = await c.req.raw.clone().text();
    if (text) body = JSON.parse(text);
  } catch {
    // fall through: malformed JSON is reported below, or by the x402 layer
  }
  const bodyKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : null;
  const key = headerKey || bodyKey;
  if (!key) return next();
  // Validate the body before spending a credit so a malformed call is never charged.
  const parsed = body ? input.safeParse(body) : null;
  if (!parsed) return c.json({ error: 'body must be JSON' }, 422);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 422);
  const spend = await store.consumeKey(key);
  if (!spend.ok) {
    return spend.reason === 'unknown'
      ? c.json({ error: 'unknown or expired API key' }, 401)
      : c.json({ error: 'API key out of credits — buy a new one at POST /keys' }, 402);
  }
  const result = await inspect(parsed.data.address);
  await store.record('inspect', 0, spend.payer, 'key');
  return c.json(result, 200, { 'X-Key-Calls-Remaining': String(spend.remaining) });
});

// Record paid calls here rather than inside the handlers: the settlement digest
// is only available on the way out, base64-JSON'd into X-PAYMENT-RESPONSE.
app.all('*', async (c) => {
  const res = await serve.fetch(c.req.raw);
  const settled = res.headers.get('X-PAYMENT-RESPONSE');
  if (res.ok && settled) {
    try {
      const { transaction, payer } = JSON.parse(Buffer.from(settled, 'base64').toString('utf8'));
      const path = new URL(c.req.url).pathname.replace(/^\//, '');
      const meta = [...serve.routes.values()].find((r) => r.meta.path === path)?.meta;
      await store.record(path, Number(meta?.priceUsdc ?? 0), payer, 'x402', transaction);
    } catch (err) {
      console.error('[metrics] could not record settled call:', err.message);
    }
  }
  return res;
});

const port = Number(process.env.PORT ?? 3000);
listen({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`sui-inspector-x402 listening on :${info.port} (payTo ${serve.payTo})`);
});
