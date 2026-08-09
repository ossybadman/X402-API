# Sui Address Inspector

An agent-payable API on Sui mainnet, built on the
[`serve-vercel`](https://github.com/mission69b/t2000/tree/main/templates/serve-vercel)
template with [`@t2000/serve`](https://www.npmjs.com/package/@t2000/serve).

`POST /inspect`, 0.01 USDC per call. Give it any Sui mainnet address and it returns
coin balances with real symbols and decimals, an owned-object profile, a staking
snapshot, the SuiNS name if one is set, and the current epoch.

No signup and no API keys. An unpaid request answers HTTP 402 with a complete
x402 payment challenge; the buyer signs a gasless USDC payment and retries.
Invalid input is rejected before any payment is taken, and a failed handler never
settles.

Discovery: `GET /openapi.json`, `GET /llms.txt`. The origin serves a storefront
listing every route and its price.

## Run it

```bash
npm install
npm run dev
```

```bash
curl -s -X POST http://localhost:3000/inspect \
  -H 'content-type: application/json' -d '{}'
```

That returns the 402 challenge. To pay one for real:

```bash
npm i -g @t2000/cli && t2 init
t2 pay https://<your-app>/inspect --data '{"address":"0x..."}'
```

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `T2000_PAY_TO` | recommended | Sui address payments settle to. Defaults to the project owner's address so a build never fails. |
| `T2000_BASE_URL` | yes in production | Public origin, used in the 402 `resource` field |
| `T2000_NAME`, `T2000_DESCRIPTION` | no | Storefront and discovery metadata |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | yes on serverless | Upstash replay store. Without it, replay protection is per instance, which is unsafe on serverless. Add Upstash from the Vercel Storage tab. |
| `SUI_GRPC_URL` | no | Sui gRPC endpoint. Defaults to the public mainnet fullnode. |
| `T2000_ACTIVITY_REPORT_URL` | no | Set to `false` to stop reporting settled calls to t2000.ai |

## Notes for anyone extending this

`lib/serve.ts` uses `createServe` rather than `createServeFromEnv`. The env helper
reads eight variables and `rpcUrl` is not among them, so it pins the 402 challenge
and settlement to the shared public fullnode with no way to override. Passing
`rpcUrl` explicitly puts every Sui call, payments included, behind one endpoint
that `SUI_GRPC_URL` controls.

`lib/sui.ts` caches coin metadata per instance. Metadata is immutable per coin
type, so this turns a per-call round trip into a warm-start lookup. Misses are
cached too, so a coin without metadata cannot cost a round trip on every request.
`lib/inspect.ts` also caps how many metadata lookups run per call, spending that
budget on the largest holdings, so one address with a long tail of dust cannot
exhaust the function time budget.

Balances are scaled with string maths, not `Number`, which would silently lose
precision above 2^53. A large SUI balance at 9 decimals reaches that easily.

`app/inspect/route.ts` exports `OPTIONS` alongside `POST`. Next only dispatches
the methods a route file exports, and without `OPTIONS` the browser CORS preflight
never reaches serve, so browser buyers fail while the CLI still works.

Sui JSON-RPC was disabled on Sui Foundation mainnet full nodes the week of
July 27, 2026. This app uses gRPC.
