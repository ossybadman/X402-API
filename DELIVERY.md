# Sui Address Inspector — a live x402 API on Sui mainnet, listed on t2000

A production HTTPS API that charges per call in USDC over x402 on Sui mainnet,
built on `@t2000/serve` and listed as a Service on the seller's Agent profile.

Source: https://github.com/ossybadman/X402-API

---

## 1. Live paid URL, method, and price

| Endpoint | Method | Price | What it returns |
|---|---|---|---|
| `https://x402-api-production-be23.up.railway.app/inspect` | `POST` | **$0.01 USDC / call** | Coin balances with symbols and human units, owned-object profile, staking snapshot, current epoch — for any Sui mainnet address |
| `https://x402-api-production-be23.up.railway.app/keys` | `POST` | **$0.10 USDC once** | A prepaid API key worth 12 `/inspect` calls via `Authorization: Bearer <key>` |

Settles to `0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b`
(agent **Badman**, on-chain Agent ID **#85**).

Request body for `/inspect`:

```json
{ "address": "0x<any Sui mainnet address>" }
```

Supporting routes, all free: `GET /` (docs), `GET /dashboard` (live seller
dashboard), `GET /stats.json`, `GET /openapi.json`, `GET /llms.txt`, `GET /health`.

---

## 2. Unpaid request returns HTTP 402 with the full Sui/x402 challenge

```bash
curl -i -X POST https://x402-api-production-be23.up.railway.app/inspect \
  -H 'content-type: application/json' \
  -d '{"address":"0x2"}'
```

Response headers:

```http
HTTP/1.1 402 Payment Required
content-type: application/json
www-authenticate: Payment realm="x402-api-production-be23.up.railway.app",
  recipient="0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b",
  currency="[object Object]", amount="0.01"
access-control-expose-headers: X-PAYMENT-RESPONSE, WWW-Authenticate
```

Response body — the complete payment challenge:

```json
{
  "x402Version": 1,
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "sui:mainnet",
      "asset": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      "maxAmountRequired": "10000",
      "payTo": "0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b",
      "resource": "https://x402-api-production-be23.up.railway.app/inspect",
      "maxTimeoutSeconds": 60,
      "extra": {
        "suimpp": {
          "challengeId": "c594471d-2774-4336-8721-24bb32136e82",
          "nonce": 2205548792,
          "chain": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
          "minEpoch": "1213",
          "maxEpoch": "1214"
        }
      }
    }
  ]
}
```

`maxAmountRequired` is `10000` raw units = 0.01 USDC at 6 decimals. The
`challengeId`/`nonce` pair is single-use, and the epoch window bounds how long
the challenge stays valid.

---

## 3. Copy-paste payment command that returns HTTP 200

```bash
t2 pay https://x402-api-production-be23.up.railway.app/inspect \
  --data '{"address":"0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b"}' \
  --max-price 0.05
```

The prepaid-key alternative — pay once, then call 12 times with no payment flow:

```bash
t2 pay https://x402-api-production-be23.up.railway.app/keys --max-price 0.15
```

```bash
curl -X POST https://x402-api-production-be23.up.railway.app/inspect \
  -H 'Authorization: Bearer si_<key from the call above>' \
  -H 'content-type: application/json' \
  -d '{"address":"0x2"}'
```

Key-authed responses carry `X-Key-Calls-Remaining`. The request body is validated
*before* a credit is deducted, so a malformed call is never charged.

---

## 4. One real paid mainnet call

<!-- TODO(seller): paste the tx digest and response body from the t2 pay run. -->

| Field | Value |
|---|---|
| Route | `POST /inspect` |
| Price | 0.01 USDC |
| Payer | `0xa315c9843b87a852239358df22a8bf85d9d15b962a205aec3ed9a901e4214aea` |
| Settled at | 2026-08-08 20:34:06 UTC |
| Tx digest | `<DIGEST>` |
| Suiscan | https://suiscan.xyz/mainnet/tx/`<DIGEST>` |

Corroborating on-chain evidence: the recipient's USDC balance moved from
`0.528155` to `0.538155` — exactly +0.01 USDC — across this call, and the
service's own `/stats.json` independently recorded it:

```json
{
  "t": 1786221246937,
  "route": "inspect",
  "via": "x402",
  "payer": "0xa315c9843b87a852239358df22a8bf85d9d15b962a205aec3ed9a901e4214aea",
  "priceUsdc": 0.01
}
```

Response excerpt:

```json
<RESPONSE EXCERPT>
```

---

## 5. Proof of the Service listing on t2000

Listed on the seller's Agent profile via `t2000_agent_sell`, which live-probed
both routes before accepting them (`probeOk: true` on each).

- **Agent**: Badman, on-chain Agent ID **#85**, address `0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b`
- **Profile**: https://t2000.ai/0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b
- **Listing digest**: `QRKiQz2uvGTm7avpbjhpYEgXaWYEAPG8JBznAbgjkpA`

Anyone can verify it independently — the registered endpoint is on-chain agent
metadata. Calling `t2000_agents` with that address returns:

```json
{
  "address": "0xd228592180633594752f32acd3a2ed612d2f4b61e9c9e86ddc4e1f676dbcbe4b",
  "numericId": 85,
  "name": "Badman",
  "category": "ai-models",
  "mcpEndpoint": "https://x402-api-production-be23.up.railway.app/inspect"
}
```

Both routes and their prices are also machine-discoverable without any t2000
tooling, at `/openapi.json` and `/llms.txt`.

---

## 6. What the next builder would miss or find unclear

1. **Node 18 silently breaks paid calls.** `@t2000/serve` needs global WebCrypto
   (Node ≥19). On Node 18 the process boots fine and `/health` returns 200, but
   every 402 throws `ReferenceError: crypto is not defined` and clients get a 503
   — a green healthcheck over a service that cannot take money. The package
   declares no `engines` field and the docs state no Node floor. Pin Node ≥20.
2. **`createServeFromEnv()` throws at import if `T2000_PAY_TO` is unset**, so the
   container crash-loops before the healthcheck ever runs. If you deploy from git
   before setting variables, the failure reads as "healthcheck failure," which
   points at the wrong thing. Worth documenting that boot hard-fails, or defaulting.
3. **The `www-authenticate` header ships `currency="[object Object]"** — an object
   interpolated into a template string at `dist/index.js:434`. The JSON body is
   correct, so only clients reading the header are affected, but t2000's own
   listing probe flags it as `PROBE_UNKNOWN_CURRENCY`. It looks like a real bug.
4. **Sui JSON-RPC is fully retired.** Public fullnodes now answer
   `-32601 Method not found ... migrate to gRPC or GraphQL`. Examples still
   reaching for `SuiClient` over JSON-RPC will fail outright; use `SuiGrpcClient`.
5. **The settlement digest never reaches your handler.** The handler context is
   `{ body, req, payer }` only. The digest lives in the `X-PAYMENT-RESPONSE`
   response header as base64 JSON (`{ transaction, payer }`), so recording it
   means wrapping `serve.fetch` and decoding on the way out. Undocumented, and
   it is the one thing every seller needs for receipts.
6. **The KV note deserves more prominence.** Without `KV_REST_API_URL`/`_TOKEN`
   replay protection is in-process — fine on a long-lived host, unsafe on
   serverless, which is exactly what the Vercel template targets. Note also that
   only the Upstash REST protocol is accepted; a plain `redis://` URL will not work.
7. **Sellers cannot easily produce the required paid-call proof themselves**, since
   paying your own endpoint from the same Passport is awkward. A documented
   self-test path would make this delivery requirement much less painful.

---

## Notes on operation

Runs as a long-lived Node process on Railway, not serverless — so the x402 replay
store stays warm in-process. Prepaid keys and call metrics persist in Redis;
credits are spent with an atomic `HINCRBY`, so concurrent requests cannot double-
spend the last credit. If Redis is unreachable the service degrades to an
in-memory store rather than failing, and `/dashboard` shows which mode is live.
