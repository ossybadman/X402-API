import { asNextRoute } from '@t2000/serve';
import { after } from 'next/server';
import { z } from 'zod';
import { serve } from '../../lib/serve';
import { inspect, inspectInput, inspectOutput } from '../../lib/inspect';
import { recordCall } from '../../lib/metrics';

// Several Sui round trips per call, so allow more than the default budget.
export const maxDuration = 30;

// asNextRoute exports OPTIONS alongside POST. Next only dispatches the methods a
// route file exports, and without OPTIONS the browser CORS preflight never reaches
// serve, so browser buyers fail while the CLI still works.
const { POST: paid, OPTIONS } = asNextRoute(
  serve
    .route({
      path: 'inspect',
      description:
        'Inspect any Sui mainnet address: coin balances with symbols and human units, owned-object profile, staking snapshot, SuiNS name, and the current epoch.',
    })
    .paid('0.01')
    .body(inspectInput, z.toJSONSchema(inspectInput))
    .response(z.toJSONSchema(inspectOutput))
    .handler(({ body }) => inspect(body.address)),
);

export { OPTIONS };

/**
 * Metrics are recorded here rather than inside the handler for two reasons.
 * The handler runs before settlement, so recording there would count calls that
 * were never paid for. And the settlement digest is not passed to the handler at
 * all; it arrives base64-JSON encoded in the X-PAYMENT-RESPONSE header on the way
 * out. after() runs the write once the response is already sent, so a buyer who
 * has paid never waits on our bookkeeping.
 */
export async function POST(req: Request): Promise<Response> {
  const res = await paid(req);
  const settled = res.headers.get('X-PAYMENT-RESPONSE');

  if (res.ok && settled) {
    after(async () => {
      try {
        const { transaction, payer } = JSON.parse(
          Buffer.from(settled, 'base64').toString('utf8'),
        ) as { transaction?: string; payer?: string };
        await recordCall({
          t: Date.now(),
          payer: payer ?? null,
          priceUsdc: 0.01,
          digest: transaction ?? null,
        });
      } catch (err) {
        console.error('[metrics] could not decode settlement:', (err as Error).message);
      }
    });
  }

  return res;
}
