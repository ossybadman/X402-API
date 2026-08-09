import { SuiGrpcClient } from '@mysten/sui/grpc';

// One endpoint for every Sui call this app makes, including the payment layer.
// Override it to move off the shared public fullnode without touching code.
export const SUI_RPC_URL = process.env.SUI_GRPC_URL ?? 'https://fullnode.mainnet.sui.io:443';

export const sui = new SuiGrpcClient({ network: 'mainnet', baseUrl: SUI_RPC_URL });

export type CoinInfo = { symbol: string; decimals: number | null };

// Coin metadata never changes for a given type, so resolving it once per instance
// turns a per-call round trip into a warm-start lookup. Misses are cached too, so
// a coin without metadata cannot cost a round trip on every request.
const metadataCache = new Map<string, CoinInfo>();

export async function coinMetadata(coinType: string): Promise<CoinInfo> {
  const cached = metadataCache.get(coinType);
  if (cached) return cached;

  const fallback: CoinInfo = { symbol: coinType.split('::').pop() ?? coinType, decimals: null };
  let resolved = fallback;
  try {
    const meta = await sui.getCoinMetadata({ coinType });
    if (meta?.coinMetadata) {
      resolved = {
        symbol: meta.coinMetadata.symbol || fallback.symbol,
        decimals: meta.coinMetadata.decimals ?? null,
      };
    }
  } catch {
    // Metadata is optional. The raw balance is still correct and still reported.
  }
  metadataCache.set(coinType, resolved);
  return resolved;
}

/**
 * Scale a raw base-unit amount by its decimals using string maths.
 * Number() would silently lose precision above 2^53, which a large SUI balance
 * (9 decimals) reaches easily.
 */
export function humanize(raw: string, decimals: number | null): string {
  if (decimals == null) return raw;
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** SuiNS reverse lookup. The node throws NOT_FOUND when an address has no name. */
export async function suinsName(address: string): Promise<string | null> {
  try {
    const res = await sui.core.defaultNameServiceName({ address });
    return (res as { name?: string })?.name ?? null;
  } catch {
    return null;
  }
}
