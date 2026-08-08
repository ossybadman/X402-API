# Sui Address Inspector: x402 paid API

A production HTTPS API on Sui mainnet that charges **$0.01 USDC per call** via the
[x402](https://docs.t2000.ai/how-to/pay-an-api) payment protocol, built with
[`@t2000/serve`](https://www.npmjs.com/package/@t2000/serve).

## Endpoint

`POST /inspect`, body `{ "address": "0x..." }`

Returns for any Sui mainnet address:

- every coin balance (raw + human units, symbol, decimals)
- owned-object profile (sample of 50, top types, StakedSui count)
- current epoch

`POST /keys` buys a prepaid API key: pay $0.10 USDC once, get 12 `/inspect` calls.
Spend a credit by passing the key either as an `Authorization: Bearer <key>`
header or as an `apiKey` field in the JSON body. The body form matters, because
the t2000 storefront's try-it dialog can only set a body, so it is the only way a
key is usable from the UI where it was bought.

A key is minted pending and becomes spendable only once its payment settles,
because `@t2000/serve` runs the route handler before it settles payment. Keys
expire 30 days after purchase.

Keys and call metrics persist in Redis when `REDIS_URL` is set. Without it the
server falls back to an in-memory store that resets on restart, which is fine for
local dev but not for real buyers. Credits are spent with an atomic `HINCRBY`, and
the request body is validated before a credit is deducted, so a malformed call is
never charged.

`GET /key` is the buyer console: remaining credits, expiry, and a form to spend
them. `GET /dashboard` is the seller dashboard (revenue, calls, prepaid keys,
wallet balance, calls-per-hour, recent activity), fed by `GET /stats.json`.

Discovery: `GET /openapi.json`, `GET /llms.txt`. Health: `GET /health`. Landing
page: `GET /`.

## Pay for a call

```bash
t2 pay https://<deployed-url>/inspect --data '{"address":"0x..."}' --max-price 0.05
```

An unpaid request answers HTTP 402 with a Sui x402 `accepts[]` challenge. Invalid
input is rejected before settlement, so a failed call is never charged.

## Run

```bash
npm install
T2000_PAY_TO=<your-sui-address> node server.mjs
```

Env: `T2000_PAY_TO` (required), `T2000_NAME`, `T2000_DESCRIPTION`,
`T2000_BASE_URL`, `REDIS_URL`, `SUI_GRPC_URL` (default
`https://fullnode.mainnet.sui.io:443`), `PORT`.

Deployed on Railway as a long-running process, so the x402 replay store stays
warm in memory and no KV service is needed.
