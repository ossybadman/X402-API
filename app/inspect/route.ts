import { asNextRoute } from '@t2000/serve';
import { z } from 'zod';
import { serve } from '../../lib/serve';
import { inspect, inspectInput, inspectOutput } from '../../lib/inspect';

// Several Sui round trips per call, so allow more than the default budget.
export const maxDuration = 30;

// asNextRoute exports OPTIONS alongside POST. Next only dispatches the methods a
// route file exports, and without OPTIONS the browser CORS preflight never reaches
// serve, so browser buyers fail while the CLI still works.
export const { POST, OPTIONS } = asNextRoute(
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
