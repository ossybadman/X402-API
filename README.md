# Sui Address Inspector — x402 paid API

A production HTTPS API on Sui mainnet that charges **$0.01 USDC per call** via the
[x402](https://docs.t2000.ai/how-to/pay-an-api) payment protocol, built with
[`@t2000/serve`](https://www.npmjs.com/package/@t2000/serve).

## Endpoint

`POST /inspect` — body `{ "address": "0x..." }`

Returns for any Sui mainnet address:

- every coin balance (raw + human units, symbol, decimals)
- owned-object profile (sample of 50, top types, StakedSui count)
- current epoch

`POST /keys` — pay $0.10 USDC once, get a prepaid API key good for 12 `/inspect`
calls via `Authorization: Bearer <key>` (no per-call payment flow). Keys are
in-memory and reset on redeploy.

Discovery: `GET /openapi.json`, `GET /llms.txt`. Health: `GET /health`. Landing page: `GET /`.

## Pay for a call

```bash
t2 pay https://<deployed-url>/inspect --data '{"address":"0x..."}' --max-price 0.05
```

An unpaid request answers HTTP 402 with a Sui x402 `accepts[]` challenge.
Invalid input is rejected before settlement — a failed call is never charged.

## Run

```bash
npm install
T2000_PAY_TO=<your-sui-address> node server.mjs
```

Env: `T2000_PAY_TO` (required), `T2000_NAME`, `T2000_DESCRIPTION`, `T2000_BASE_URL`,
`SUI_GRPC_URL` (default `https://fullnode.mainnet.sui.io:443`), `PORT`.

Deployed on Railway as a long-running process (in-memory replay store — no KV needed).
