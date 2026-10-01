# CLAUDE.md

## Project Overview

Jupiter CLI (`jup`) — a TypeScript CLI for interacting with Jupiter's products on Solana: Spot, Perps, Lend, Prediction Markets and more. Uses Commander.js for command parsing, @solana/kit for transaction signing, and ky for HTTP requests.

**Distribution:** See `.github/workflows/release.yml` — publishes to npm and creates GitHub releases with compiled binaries on version bump to `main`.

## Commands

```bash
# Run in development
bun run dev

# Compile to standalone binary
bun build src/index.ts --compile --outfile jup

# Format code
bunx prettier --write .

# Run all tests: lint, typecheck, tests
bun run ci
```

## Architecture

**Entry point:** `src/index.ts` — initializes config, registers 11 command groups with Commander.

**Commands** (`src/commands/`): Static classes that register subcommands. Each delegates to library modules.

- `ConfigCommand` — `config list`, `config set`
- `GachaCommand` — `gacha packs/open/gift/buyback/collection/activity/verify/winners/leaderboard`; registers `GachaMarketCommand` (`gacha marketplace/card/buy/list/delist`) and `GachaShippingCommand` (`gacha shipping/ship`)
- `KeysCommand` — `keys list/add/delete/edit/use/solana-import`
- `LendCommand` — `lend earn tokens/positions/deposit/withdraw`
- `PerpsCommand` — `perps positions/markets/open/set/close`
- `PredictionsCommand` — `predictions events/positions/open/close/history`
- `RewardsCommand` — `rewards campaigns/leaderboard/progress/unclaimed/claim/apply`
- `SignCommand` — `sign --tx <base64>`
- `SpotCommand` — `spot tokens/quote/swap/portfolio/history/transfer/reclaim`
- `SpotLimitCommand` — `spot limit open/orders/history/set/close` (registered under `spot`)
- `SpotDcaCommand` — `spot dca open/orders/history/close` (registered under `spot`)
- `SpotDiscoveryCommand` — `spot tokens --list`, `spot pulse/heatmap/alphascan/categories/launchpads/smart-money/stocks` (registered under `spot`)
- `SpotTokenCommand` — `spot token info/chart/net-volume/holders/traders/txs/dev/pools/about/news`
- `SpotWatchCommand` — `spot watchlist list/add/remove/use/delete`, `spot tracker list/add/remove/trades/import/export`
- `UpdateCommand` — `update` (self-update CLI to latest version)
- `VrfdCommand` — `vrfd check/submit`

**Libraries** (`src/lib/`):

- `Asset` — token metadata (mint addresses, decimals) for SOL, BTC, ETH, USDC; `resolveAsset()` for name lookup
- `Config` — manages `~/.config/jup/settings.json` (activeKey, output format, API key, RPC URL)
- `Rpc` — sends signed transactions straight to Solana and confirms them, for flows without a Jupiter execute endpoint
- `DcaV1` — builds the legacy V1 DCA close transaction client-side
- `Signer` — loads keypairs from `~/.config/jup/keys/{name}.json`, signs transactions and messages
- `KeyPair` — generates/recovers keypairs (BIP39 mnemonics, BIP32 derivation)
- `Output` — renders data as table (via cli-table3) or JSON based on config; also provides display formatters (`formatDollar`, `formatCompactDollar`, `formatBoolean`, `formatPercentageChange`)
- `NumberConverter` — converts between human-readable and on-chain decimal amounts
- `Swap` — shared swap execution logic used by SpotCommand and LendCommand; manual swap settings and Shield token warnings
- `TriggerOrder` — pure limit/DCA order logic: intent → payload mapping, target prices (USD, market cap, % from market), expiry/interval parsing, minimums
- `OrderTokens` — token metadata lookup for order lists (symbols, decimals, UI amounts)
- `RewardsCampaign` — campaign status/claim-window rules and campaign application validation
- `Gacha` — maps gacha packs, cards and marketplace responses to CLI output

**API Clients** (`src/clients/`):

- `TokenFilters` — jup.ag screener filters as CLI options, mapped to datapi params
- `TokenView` — maps datapi assets to token rows and renders token tables
- `OptionParsers` — commander argument parsers (positive ints, numbers, lists, timestamps)
- `Watchlist` — local watchlists in `~/.config/jup/watchlist.json` (web `intel_watchlist_config` schema)
- `WalletTracker` — local followed wallets in `~/.config/jup/tracker.json` (web tracker schema, Axiom share import/export)

**API Clients** (`src/clients/`):

- `DatapiClient` — Jupiter token data/search API, plus datapi.jup.ag discovery data (lists, gems, heatmap, categories, launchpads, smart money, charts, holders, txs, shield, stocks, tracker trades)
- `ContentClient` — content-api.jup.ag market briefs (Market Pulse)
- `IntelClient` — Jupiter Intel AI token description and news (requires an API key)
- `UltraClient` — Jupiter Ultra swap API (quote + execute)
- `PerpsClient` — Jupiter Perps API v2 (positions, orders, TP/SL)
- `LendClient` — Jupiter Lend API (earn tokens, positions, earnings)
- `PredictionsClient` — Jupiter Predictions API v1 (events, positions, orders, history)
- `VrfdClient` — Jupiter Token Verification API (eligibility check, payment, execute)
- `TriggerClient` — Jupiter Trigger API v2 (`trigger-api.jup.ag`: limit + DCA orders, vault, signed-message JWT auth cached in `~/.config/jup/auth/{address}.json`) and legacy V1 limit/DCA order lists
- `RewardsClient` — Jupiter Rewards API on datapi.jup.ag (campaigns, stats, leaderboards, claims) and remote-api.jup.ag campaign applications
- `GachaClient` — Jupiter TCG API on tcgapi.jup.ag (packs, pulls, gifts, buyback, leaderboard) and the jup.ag Collector Crypt proxy (marketplace, shipping)

**Spot swap flow:** token search → Swap.execute → UltraClient.getOrder → Signer.signTransaction → UltraClient.postExecute

**Perps flow:** PerpsClient.post* → Signer.signTransaction → PerpsClient.postExecute

**Lend deposit/withdraw flow:** LendClient.getTokens → resolve jlToken → Swap.execute → LendClient.getPositions (updated state)

**Predictions flow:** PredictionsClient.postOrder → Signer.signTransaction → PredictionsClient.postExecute

**Limit/DCA order flow:** TriggerClient auth (challenge → Signer.signMessage → verify) → TriggerClient.checkMints → ensureVault → craftDeposit → Signer.signTransaction → createPriceOrder/createDcaOrder (server broadcasts the deposit)

**Rewards claim flow:** RewardsClient.getClaimTransaction → Signer.signTransaction → RewardsClient.postClaim (server broadcasts)

**Gacha pack flow:** GachaClient.generatePack → Signer.signTransaction → GachaClient.submitPack → GachaClient.openPack

**Gacha marketplace flow:** GachaClient.buildMarketplaceTx → Signer.signTransaction → GachaClient.broadcast

**Gacha shipping flow:** GachaClient.getShippingNonce → Signer.signMessage → GachaClient.verifyShippingSignIn → bearer-token reads, estimate/prepare → Signer.signTransaction → GachaClient.submitShipping

**Vrfd flow:** VrfdClient.checkEligibility → VrfdClient.craftTxn → Signer.signTransaction → VrfdClient.execute

**Spot discovery flow:** DatapiClient (keyless datapi.jup.ag) → TokenView rows → Output; watchlists and followed wallets persist locally via Watchlist / WalletTracker

## CLI Conventions

When adding new commands, both input (options/arguments) and output (JSON/table) must be consistent with existing commands so that both humans and AI agents can reliably use and parse them. Check `docs/` for the canonical command shapes.

### Input

- **Option naming:** Reuse established option names — e.g. `--key <name>`, `--address <address>`, `--side <side>`, `--amount <usd>`, `--limit <n>`, `--asset <asset>`. Avoid synonyms for the same concept across commands.
- **Mutually exclusive options:** `--key` and `--address` are mutually exclusive (one resolves from keystore, the other is a raw wallet address). Follow this pattern for wallet resolution.
- **Side values:** Accept both long/short forms where applicable — e.g. `yes`/`y`/`no`/`n` for predictions, `long`/`short`/`buy`/`sell` for perps.
- **Subcommand verbs:** Use `open`/`close` for entering/exiting positions, `set` for updating, `positions`/`history`/`markets` for read-only queries.

### Output

- **Field naming:** Reuse established key names — e.g. `sizeUsd`, `priceUsd`, `pnlUsd`, `pnlPct`, `feeUsd`, `signature`, `positionPubkey`, `side`, `asset`, `leverage`. Check `docs/perps.md`, `docs/spot.md`, and `docs/predictions.md` for the canonical JSON shapes.
- **Value types:** Dollar amounts are `number`, percentages are `number` (e.g. `5.97` means +5.97%), nullable fields use `null` (not `0` or `""`), transaction hashes use `signature`.
- **Table headers:** Match the JSON key semantics — e.g. a JSON field `signature` maps to table header "Tx Signature", `pnlUsd` maps to "PnL".
- **Formatters:** Use `Output.formatDollar()`, `Output.formatDollarChange()`, `Output.formatPercentageChange()` for consistent styling. Pass `{ decimals: N }` to `formatDollar` when explicit precision is needed.

## Code Style

- Prettier with default config (double quotes, semicolons, 80 char width, trailing commas in ES5 positions)
- TypeScript strict mode, ESNext target, bundler module resolution
- All core modules use static methods (no instantiation for Config, Output, NumberConverter, clients)
- Signer and KeyPair use instance methods with static factory constructors
