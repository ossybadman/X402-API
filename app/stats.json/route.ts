import { serve } from '../../lib/serve';
import { readStats } from '../../lib/metrics';
import { sui } from '../../lib/sui';

export const dynamic = 'force-dynamic';

const USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

async function payToUsdcBalance(): Promise<number | null> {
  try {
    const b = (await sui.getBalance({ owner: serve.payTo, coinType: USDC_TYPE })) as {
      balance?: { balance?: string } | string;
    };
    const raw =
      typeof b.balance === 'object' ? (b.balance?.balance ?? '0') : ((b.balance as string) ?? '0');
    return Number(raw) / 1e6;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const [stats, onchainUsdc] = await Promise.all([readStats(), payToUsdcBalance()]);
  return Response.json(
    { service: serve.name, payTo: serve.payTo, onchainUsdc, ...stats },
    { headers: { 'cache-control': 'no-store' } },
  );
}
