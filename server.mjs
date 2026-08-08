import { serve as listen } from '@hono/node-server';
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

const serve = createServeFromEnv();

serve
  .route({
    path: 'inspect',
    description:
      'Inspect any Sui mainnet address: coin balances (with symbols and human units), owned-object profile, staking snapshot, current epoch.',
  })
  .paid('0.01')
  .body(input, z.toJSONSchema(input))
  .response(z.toJSONSchema(output))
  .handler(async ({ body }) => inspect(body.address));

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, service: serve.name ?? 'sui-inspector-x402' }));
app.all('*', (c) => serve.fetch(c.req.raw));

const port = Number(process.env.PORT ?? 3000);
listen({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`sui-inspector-x402 listening on :${info.port} (payTo ${serve.payTo})`);
});
