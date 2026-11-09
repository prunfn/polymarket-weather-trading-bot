# Phase 1 security boundary

Baseline: `2fce4d387a6ded64db6a99ea33e0780368c29c8b`.
This PR supports public data reads and local paper simulation only. It is not
ready for funded accounts. No real private key, wallet, allowance or order is
needed for development, tests or CI.

## Implemented

- Official `@polymarket/client` 0.17.0 replaces the archived CLOB SDK. Public
  order books use `createPublicClient` and `fetchOrderBook({ assetId })`.
  `forkEnvironmentConfig` retains the existing `CLOB_HOST` setting. That SDK
  helper is experimental; the exact version is pinned. Node >=24 is required.
- No secure client, signer, credential derivation, spending approval or order
  submission implementation remains. `auth` fails without printing credentials.
  Live `run`/`watch` and direct executor/order calls fail closed, regardless of
  supplied credentials. There is no environment flag that enables live trading.
- `scan` and `forecast` need no credentials. `scan` never records fills or saves
  state, even with live selected. `portfolio` reads local state, not an account.
  Paper runs still simulate immediate fills and persist them locally.
- Configuration excludes wallet/API credentials. Errors report invalid field
  names only. All bot console output passes through redaction of configured
  credential values (including URL/JSON escaped forms), sensitive object fields
  and private-key-shaped hex strings. Do not log credentials or raw auth data
  in future code, even with this defense. Redaction is not a secret vault.
- `.env.*` files are ignored except `.env.example`; no credential placeholders
  encourage entering a key. Existing secrets in old logs, local state or Git
  history are not detected or erased by this change. If credentials were ever
  exposed by the previous `auth` command, revoke/rotate them independently.
- Unused `kelly-stake` and obsolete `ethers` dependencies are removed. Sizing,
  strategy rules, forecast inputs and defaults are unchanged.

## Dependency and installation review

The baseline package scripts were read before running project code: only CLI,
TypeScript and tsx commands existed, with no root install/prepare lifecycle hook.
Imports were reviewed; `kelly-stake` had no callers and ethers only served the
removed signer path. The official SDK README and published 0.17.0 declarations
were inspected before migration. The published SDK has no install hooks and
its optional signer adapters are not installed.

All direct versions and the full npm lockfile are committed; `.npmrc` sets
`ignore-scripts=true`, `save-exact=true` and `engine-strict=true`. Use Node
24.14.0 (`.nvmrc`) and npm 11.12.1 (`packageManager`) for the checked toolchain.
Generate/update locks with scripts disabled, review the lock diff and package
scripts, then use `npm ci --ignore-scripts`.

The resolved graph advertised esbuild's `node install.js` and macOS optional
fsevents' `node-gyp rebuild` installation hooks. Neither ran. esbuild's platform
binary is supplied by its locked optional package; tests work without its
postinstall. Installed manifests also contain source-development `prepare`
scripts in ky and msgpack; all lifecycle scripts remain disabled. Do not enable
scripts or add a wallet adapter to bypass a failure.

On 2026-11-09, initial resolution with Zod 3.25.76 reported high-severity
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Zod was upgraded to patched 4.6.7, also used by the SDK. The final npm audit
reported zero known vulnerabilities. An audit is time-dependent and does not
prove packages are safe; review every update and its integrity/provenance.

## Remaining risks and requirements for later PRs

1. Public responses are untrusted. Gamma and weather response shapes, numeric
   ranges, payload sizes, endpoint overrides and redirect behavior need tighter
   validation. Missing/invalid/stale/crossed books, SDK schema changes and partial
   source failures can still produce misleading research output. Book fallbacks
   and strategy behavior are deliberately preserved here. Protocol V2 asset
   discovery (`positionIds` vs legacy `clobTokenIds`) needs a separate verified
   migration; no guessed conversion is introduced.
2. Validate complete mutually exclusive bucket ladders, station identity,
   rounding, bias and forecast calibration before interpreting any edge. The
   current intraday floor comes from forecast hourly values, not independently
   verified observations. `daysAhead` uses month values directly in `Date.UTC`;
   calendar-boundary correctness needs regression tests in a later PR.
3. JSON state has no schema validation, atomic writes, process locking or
   corruption recovery guarantees. It can silently reset on read failures.
   Paper and historical live records share one state file. Keep this local
   research state isolated; do not treat it as a broker ledger.
4. Paper fills do not model fees, slippage, partial fills, rejections or settlement.
   A venue accepting an order is not proof of a fill. Any future live work needs
   order/fill reconciliation, idempotency, cancellation, balance/allowance checks,
   risk limits validated against actual holdings, and a tested emergency stop.
5. Authentication, signing, custody, safe credential provisioning and rotation,
   log review, SDK compatibility and minimum approvals require a separately
   approved design. Never restore printed credential bootstrap or automatic
   approvals. No live tests or funded-wallet validation were performed here.
6. CI runs without secrets, with read-only repository permissions and pinned
   action commits. Repository branch protection, independent review and ongoing
   dependency monitoring still need maintainer configuration.

## Can PR #2 begin?

Yes, for an offline/read-only data and state reliability PR based on this change,
once Phase 1 review and CI are green. Start with response/asset-ID validation,
calendar tests and state isolation, retaining the live/authentication blocks.
There is no supplied PR #2 specification, so this is a scope boundary, not
approval of an unknown implementation. PR #2 must not enable or test real trading;
funded operation remains blocked by the requirements above.

## Official SDK sources

- [SDK README](https://github.com/Polymarket/ts-sdk/tree/main/packages/client)
- [Legacy SDK migration](https://docs.polymarket.com/migrate/clob-sdk-to-unified-sdk)
- [Public books and asset identifiers](https://docs.polymarket.com/market-data/prices-order-books)
