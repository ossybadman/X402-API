import { createServe, UpstashDigestStore, DEFAULT_ACTIVITY_REPORT_URL } from '@t2000/serve';
import { SUI_RPC_URL } from './sui';

// Built with createServe rather than createServeFromEnv so rpcUrl can be set.
// The env helper reads eight variables and rpcUrl is not one of them, which pins
// the 402 challenge and settlement to the shared public fullnode with no way out.
// Passing it here moves every Sui call, payments included, to one endpoint.

const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

if (!kvUrl || !kvToken) {
  console.warn(
    '[serve] No KV_REST_API_URL/KV_REST_API_TOKEN. Replay protection is per instance, which is unsafe on serverless. Add Upstash from the Vercel Storage tab.',
  );
}

export const serve = createServe({
  // Public by design: this address appears in every 402 challenge. Defaulting it
  // keeps a build from failing when the variable has not been set yet.
  payTo:
    process.env.T2000_PAY_TO ?? '0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b',
  network: 'mainnet',
  name: process.env.T2000_NAME ?? 'Sui Address Inspector',
  description:
    process.env.T2000_DESCRIPTION ??
    'Balances, objects, and stakes for any Sui mainnet address, paid per call in USDC.',
  baseUrl: process.env.T2000_BASE_URL,
  rpcUrl: SUI_RPC_URL,
  store: kvUrl && kvToken ? new UpstashDigestStore({ url: kvUrl, token: kvToken }) : undefined,
  activityReportUrl:
    process.env.T2000_ACTIVITY_REPORT_URL === 'false' ? undefined : DEFAULT_ACTIVITY_REPORT_URL,
});
