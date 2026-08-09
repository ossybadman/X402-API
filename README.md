# Sui Address Inspector

An agent-payable API on Sui mainnet. Send it any address, get back what that
address holds. Pay 0.01 USDC per call over x402, gasless, with no signup and no
API keys.

**Live:** https://sui-inspector-x402.vercel.app
&nbsp;·&nbsp;
**Store page:** https://t2000.ai/0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b

Built on the [serve-vercel template](https://github.com/mission69b/t2000/tree/main/templates/serve-vercel)
with [`@t2000/serve`](https://www.npmjs.com/package/@t2000/serve).

---

## What it returns

| Field | Description |
|---|---|
| `address` | Normalized Sui address |
| `suinsName` | SuiNS name if one is set, otherwise `null` |
| `suiBalance` | Total SUI in human units |
| `balances[]` | Every coin type held, with `symbol`, `decimals`, raw `balance`, and `humanBalance` |
| `objects` | `sampledCount` over the first 50 owned objects, `hasMore`, `stakedSuiObjects`, and the 10 most common `topTypes` |
| `inspectedAtEpoch` | Epoch the read was taken at |

Object counts are a sample of 50 rather than a full pagination, and `hasMore`
says so plainly instead of implying a complete count.

---

## Buy a call

Two ways, no account needed for either.

### Through the marketplace

Open the [store page](https://t2000.ai/0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b),
press **Try** on `POST /inspect`, put an address in the body, and pay from your
Passport in the browser.

```json
{ "address": "0x2" }
```

### Through the t2000 CLI

```bash
npm i -g @t2000/cli
t2 init          # creates a wallet if you do not have one
t2 receive       # prints your address so you can fund it
```

```bash
t2 pay https://sui-inspector-x402.vercel.app/inspect \
  --data '{"address":"0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b"}' \
  --max-price 0.05
```

The CLI handles the whole exchange: it receives the 402, signs a gasless USDC
payment, retries, and prints the response body.

### Directly over HTTP

Nothing here is t2000-specific, it is the open x402 standard. Any client can
`POST`, read the 402 challenge, sign a USDC transfer matching `payTo` and
`maxAmountRequired`, and retry with an `X-PAYMENT` header. The settlement digest
comes back in `X-PAYMENT-RESPONSE`, so every call leaves an on-chain receipt.

See the price for free at any time:

```bash
curl -s -X POST https://sui-inspector-x402.vercel.app/inspect \
  -H 'content-type: application/json' -d '{}'
```

---

## Routes

| Route | Price | Purpose |
|---|---|---|
| `POST /inspect` | 0.01 USDC | The API |
| `GET /` | free | Storefront listing every route and price |
| `GET /openapi.json` | free | Machine-readable spec |
| `GET /llms.txt` | free | Plain-text agent guidance |
| `GET /dashboard` | free | Seller view: revenue, calls, payers, recent settlements |
| `GET /stats.json` | free | Data behind the dashboard |

---

## Run locally

```bash
npm install
npm run dev
```

Set `T2000_PAY_TO` to your own Sui address first, or payments will settle to the
address baked in as the default.

---

## Deploy

Vercel, from this repo. Then add **Upstash for Redis** from the Storage tab,
which injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.

| Variable | Required | Purpose |
|---|---|---|
| `T2000_PAY_TO` | recommended | Address payments settle to. Defaults to the project owner's, so a build never fails without it. |
| `T2000_BASE_URL` | in production | Public origin, used in the 402 `resource` field |
| `KV_REST_API_URL` | on serverless | Upstash replay store, see below |
| `KV_REST_API_TOKEN` | on serverless | Paired with the above |
| `T2000_NAME` | no | Storefront title |
| `T2000_DESCRIPTION` | no | Storefront subtitle |
| `SUI_GRPC_URL` | no | Sui endpoint, defaults to the public mainnet fullnode |
| `T2000_ACTIVITY_REPORT_URL` | no | Set to `false` to stop reporting settled calls to t2000.ai |

### List it

```bash
npx @t2000/cli agent sell https://<your-app>/inspect
```

The marketplace probes your 402, expands the route list from `/openapi.json`, and
publishes a store card. Only the wallet that owns `payTo` can list it.

---

## How it works

```
POST /inspect
  ├─ no payment      → 402 with an accepts[] challenge, free
  ├─ invalid input   → 422, before settlement, never charged
  └─ valid payment   → handler runs → payment settles → 200
                                    └─ digest in X-PAYMENT-RESPONSE
```

`lib/serve.ts` builds the serve instance, `lib/inspect.ts` holds the Sui logic,
`lib/sui.ts` owns the client and its caches, and `lib/metrics.ts` records settled
calls. Routes in `app/` stay thin.

---

## Notes for anyone extending this

**Use `createServe`, not `createServeFromEnv`.** The env helper reads eight
variables and `rpcUrl` is not one of them, so it pins the 402 challenge and
settlement to the shared public fullnode with no way to override. Passing
`rpcUrl` explicitly puts every Sui call, payments included, behind one endpoint
that `SUI_GRPC_URL` controls.

**Record side effects after settlement, not in the handler.** The handler runs
*before* payment settles, so anything it does still happened if settlement then
fails. `app/inspect/route.ts` wraps the paid route and records from the
`X-PAYMENT-RESPONSE` header instead, inside `after()` so a paying buyer never
waits on bookkeeping.

**The replay store is a correctness requirement on serverless.** Without the
Upstash pair, each instance keeps its own memory of spent payments, so a buyer
can replay a signed payment against a different instance. Only the Upstash REST
protocol works; a plain `redis://` URL will not.

**Export `OPTIONS` from paid routes.** Next only dispatches the methods a route
file exports. Without it the browser CORS preflight never reaches serve, so
browser buyers fail while the CLI keeps working.

**Coin metadata is cached per instance** and lookups are capped at the 20 largest
holdings, so an address with a long tail of dust cannot exhaust the function
budget. A repeat call drops from about 1320ms to 815ms.

**Balances are scaled with string maths**, not `Number`, which silently loses
precision above 2^53. A large SUI balance at 9 decimals passes that easily.

**Sui JSON-RPC is gone.** Disabled on Sui Foundation mainnet full nodes the week
of July 27, 2026. This app uses gRPC.
