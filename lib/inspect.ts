import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { coinMetadata, humanize, suinsName, sui } from './sui';

export const inspectInput = z.object({
  address: z
    .string()
    .describe('Sui address to inspect (0x-prefixed, mainnet)')
    .refine((a) => isValidSuiAddress(a), 'not a valid Sui address'),
});

export const inspectOutput = z.object({
  address: z.string(),
  suinsName: z.string().nullable().describe('SuiNS name if one is set, otherwise null'),
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
const OBJECT_SAMPLE = 50;

// Metadata resolution is one round trip per coin type. Cap how many run so an
// address holding a long tail of dust cannot exhaust the function time budget.
// The largest holdings are the ones worth naming; the rest keep their raw type.
const METADATA_LOOKUP_LIMIT = 20;

export async function inspect(address: string) {
  const addr = normalizeSuiAddress(address);

  const [balancePage, objectsPage, sys, name] = await Promise.all([
    sui.listBalances({ owner: addr }),
    sui.listOwnedObjects({ owner: addr, limit: OBJECT_SAMPLE }),
    sui.core.getCurrentSystemState(),
    suinsName(addr),
  ]);

  const raw = balancePage.balances.map((b) => ({
    coinType: b.coinType,
    balance: String(b.balance),
  }));

  // Rank by magnitude first so the lookup budget is spent on real holdings.
  const ranked = [...raw].sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
  const named = new Set(ranked.slice(0, METADATA_LOOKUP_LIMIT).map((b) => b.coinType));

  const balances = await Promise.all(
    raw.map(async (b) => {
      const meta = named.has(b.coinType)
        ? await coinMetadata(b.coinType)
        : { symbol: b.coinType.split('::').pop() ?? b.coinType, decimals: null };
      return {
        coinType: b.coinType,
        symbol: meta.symbol,
        decimals: meta.decimals,
        balance: b.balance,
        humanBalance: humanize(b.balance, meta.decimals),
      };
    }),
  );

  const suiRaw = raw.find((b) => b.coinType.endsWith(SUI_TYPE_SUFFIX))?.balance ?? '0';

  const typeCounts = new Map<string, number>();
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
    suinsName: name,
    suiBalance: humanize(suiRaw, 9),
    balances,
    objects: {
      sampledCount: objectsPage.objects.length,
      hasMore: objectsPage.hasNextPage,
      stakedSuiObjects,
      topTypes,
    },
    inspectedAtEpoch: String(
      (sys as { systemState?: { epoch?: string }; epoch?: string }).systemState?.epoch ??
        (sys as { epoch?: string }).epoch ??
        '',
    ),
  };
}
