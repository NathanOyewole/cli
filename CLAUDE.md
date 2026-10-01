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

**Entry point:** `src/index.ts` — initializes config, registers 15 command groups with Commander.

**Commands** (`src/commands/`): Static classes that register subcommands. Each delegates to library modules.

- `ConfigCommand` — `config list`, `config set`
- `DepositCommand` — `deposit receive/onramp/bridge-tokens/bridge-quote`
- `GachaCommand` — `gacha packs/open/gift/buyback/collection/activity/verify/winners/leaderboard`; registers `GachaMarketCommand` (`gacha marketplace/card/buy/list/delist`) and `GachaShippingCommand` (`gacha shipping/ship`)
- `GiftCommand` — `gift create/claim/info/clawback/pending/history`
- `KeysCommand` — `keys list/add/delete/edit/use/solana-import`
- `LendCommand` — `lend earn tokens/positions/deposit/withdraw/history/chart` (all lend commands take `--market main|ethena`); registers:
  - `LendBorrowCommand` — `lend borrow vaults/vault/positions/history/liquidations/open/deposit/borrow/repay/withdraw/operate/close`
  - `LendMultiplyCommand` — `lend multiply vaults/open/set/close`
  - `LendToolsCommand` — `lend markets`, `lend stats earn/borrow/liquidity/dex/positions`, `lend strategies/calculator/transparency` (static data in `LendTransparency.ts`)
- `PerpsCommand` — `perps positions/markets/open/set/close/history`; registers the perps subgroups below. `PerpsCollateral` implements `perps set --add-collateral/--remove-collateral`
- `PerpsJlpCommand` — `perps jlp info/mint/burn`
- `PerpsLoansCommand` — `perps loans info/positions/history/borrow/repay`
- `PerpsLeaderboardCommand` — `perps leaderboard/stats`
- `PerpsDeltaNeutralCommand` — `perps delta-neutral info/history/positions/deposit/withdraw`
- `PerpsJtxCommand` — `perps jtx markets/orderbook/positions/history/open/close/set` (orderbook markets on gum-api)
- `PortfolioCommand` — `portfolio positions/pnl/airdrops`, `portfolio addressbook list/add/remove`
- `PredictionsCommand` — `predictions events/positions/open/close/history`; registers the predictions subcommand files below
- `PredictionsAccountCommand` — `predictions orders/claim/leaderboard/profile/pnl/set-username`
- `PredictionsArcadeCommand` — `predictions arcade rounds/open/positions/history`
- `PredictionsCommunityCommand` — `predictions clans ...`, `predictions comments list/post/like/delete`
- `PredictionsDiscoveryCommand` — `predictions categories/suggested/market/timed/score/price-history/trades/orderbook`
- `RewardsCommand` — `rewards campaigns/leaderboard/progress/unclaimed/claim/apply`
- `SignCommand` — `sign --tx <base64>`
- `SpotCommand` — `spot tokens/quote/swap/portfolio/history/transfer/reclaim`
- `SpotDcaCommand` — `spot dca open/orders/history/close` (registered under `spot`)
- `SpotDiscoveryCommand` — `spot tokens --list`, `spot pulse/heatmap/alphascan/categories/launchpads/smart-money/stocks` (registered under `spot`)
- `SpotLimitCommand` — `spot limit open/orders/history/set/close` (registered under `spot`)
- `SpotTokenCommand` — `spot token info/chart/net-volume/holders/traders/txs/dev/pools/about/news`
- `SpotWatchCommand` — `spot watchlist list/add/remove/use/delete`, `spot tracker list/add/remove/trades/import/export`
- `StakeCommand` — `stake info/accounts/rewards`, `stake native deposit/deactivate/reactivate/withdraw/split/merge/convert`, `stake jupsol deposit/withdraw`
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
- `Swap` — shared swap execution logic used by SpotCommand; manual swap settings and Shield token warnings
- `JtxOrder` — JTX order sizing (collateral × leverage within margin and fee), price/size snapping, order limits
- `DeltaNeutralVault` — ntbundle program: account decoders (bundle, oracle, user), deposit/withdraw instruction builders, unsigned v0 tx via @solana/kit
- `JupStake` — reads a wallet's max-locked staked JUP from the governance escrow (JTX private-beta gate)
- `PerpsTx` — perps sign helpers: `signAndExecute` (perps-api `/transaction/execute`) and `signAndSend` (straight to RPC via `Rpc`), plus `--key`/`--address` resolution
- `TriggerOrder` — pure limit/DCA order logic: intent → payload mapping, target prices (USD, market cap, % from market), expiry/interval parsing, minimums
- `OrderTokens` — token metadata lookup for order lists (symbols, decimals, UI amounts)
- `RewardsCampaign` — campaign status/claim-window rules and campaign application validation
- `Gacha` — maps gacha packs, cards and marketplace responses to CLI output
- `PredictionsExecution` — signs server-built Predict transactions, submits them to `/execute` with their execution context, and polls for order fills
- `PredictionsAuth` — wallet-signed message templates and comment session keys for Predict's off-chain actions (clans, usernames, comments)
- `PredictionsFormat` — shared Predict output helpers (event JSON, dates, `--key`/`--address` resolution)
- `AddressBook` — saved wallets and groups in `~/.config/jup/addressbook.json`; resolves `--address` lists (incl. built-in `demo` wallets)
- `InviteCode` — gift codes: generation and the `sha256("invite:" + code)` gift keypair, compatible with jup.ag/gift links
- `PortfolioPositions` — normalizes Portfolio API elements (v1 and v2) into one position shape
- `LendTx` — composes lend transactions with kit: API instruction conversion, compute budget, ATAs, SOL wrap/unwrap, v0 compile with lookup tables, size check, sign and send via `Rpc`
- `LendFlashloan` — Jupiter Lend flashloan borrow/payback instructions (built from program IDs, seeds and IDL; no SDK)
- `LendMath` — vault APYs, position health (LTV, liquidation price, status), max multiplier, APY from exchange price, days to liquidation
- `LendOptions` — shared lend options (`--market`) and wallet resolution

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
- `PerpsClient` — Jupiter Perps API v2 (positions, orders, TP/SL, pool info, collateral limits, expired orders, leaderboard, CSV export)
- `JlpClient` — Perps API v2 JLP pool (info, mint, burn) and JLP loans
- `NeutralTradeClient` — Perps API proxy of Neutral Trade vault config, metrics, snapshots
- `JtxPerpsClient` — JTX orderbook perps API (gum-api): markets, order book, trading accounts, cross-chain intents
- `LendClient` — Jupiter Lend API (earn tokens, positions, earnings, earn and borrow instruction builders)
- `PredictionsClient` — Jupiter Predictions API v1 (events, markets, positions, orders, tickets, claims, history, profiles, leaderboards)
- `PredictionsArcadeClient` — Predictions API v1 `play/*` (1-minute arcade rounds and bets)
- `PredictionsCommunityClient` — Predictions API v1 clans, comments, and usernames (wallet-signed messages)
- `PredictionsPriceClient` — Predict price service (price-to-beat REST, one-shot orderbook WebSocket)
- `FluidClient` — Jupiter Lend indexer at api.solana.fluid.io used by jup.ag (earn history/charts, vaults, positions, PnL, liquidations, statistics)
- `SwapV1Client` — Jupiter swap API v1 (quote + swap instructions) for composing swaps into lend multiply transactions
- `VrfdClient` — Jupiter Token Verification API (eligibility check, payment, execute)
- `TriggerClient` — Jupiter Trigger API v2 (`trigger-api.jup.ag`: limit + DCA orders, vault, signed-message JWT auth cached in `~/.config/jup/auth/{address}.json`) and legacy V1 limit/DCA order lists
- `RewardsClient` — Jupiter Rewards API on datapi.jup.ag (campaigns, stats, leaderboards, claims) and remote-api.jup.ag campaign applications
- `GachaClient` — Jupiter TCG API on tcgapi.jup.ag (packs, pulls, gifts, buyback, leaderboard) and the jup.ag Collector Crypt proxy (marketplace, shipping)
- `PortfolioClient` — Jupiter Portfolio API (`api.jup.ag/portfolio` v1, or v2 with a key that has access; airdrop checker) and datapi spot PnL
- `InviteClient` — Ultra gift (invite) API: craft-invite/claim/clawback, execute, info, pending, history
- `StakeClient` — Jupiter Stake API (`api.jup.ag/stake/v1`): stake accounts, craft-* + execute, JupSOL liquid/delayed-unstake orders
- `DepositClient` — jup.ag/api proxies: universal deposit addresses, onramp URL, bridge tokens and quotes

**Spot swap flow:** token search → Swap.execute → UltraClient.getOrder → Signer.signTransaction → UltraClient.postExecute

**Perps flow:** PerpsClient.post* → Signer.signTransaction → PerpsClient.postExecute

**Lend earn flow:** LendClient.getTokens → LendClient.postEarnInstructions → LendTx (ATAs, SOL wrap, compile) → Signer.signTransaction → Rpc.sendAndConfirm

**Lend borrow flow:** FluidClient (vault/position) → LendClient.postOperateInstructions → LendTx → Signer.signTransaction → Rpc.sendAndConfirm

**Lend multiply flow:** LendFlashloan.borrowIx → SwapV1Client swap instruction → LendClient.postOperateInstructions → LendFlashloan.paybackIx → LendTx.compile (fits check) → Rpc.sendAndConfirm

**JTX flow:** JtxPerpsClient.post{CreateOrder,CancelOrder,Collateral} → Signer.signTransaction → JtxPerpsClient.postExecute → poll order history

**Delta neutral flow:** DeltaNeutralVault.getState/getUser → deposit/withdraw instructions → buildTransaction → Signer.signTransaction → Rpc.sendAndConfirm

**JLP / loans / expired-order flow:** JlpClient.post* (or PerpsClient.getExpiredOrders) → Signer.signTransaction → Rpc.sendAndConfirm

**Predictions flow:** PredictionsClient.postOrder → Signer.signTransaction → PredictionsClient.postExecute (echoes `execution.context`) → PredictionsExecution.waitForFill (orders, then history)

**Predictions social flow:** PredictionsAuth message → Signer.signMessage → PredictionsCommunityClient (comments add a session key that signs each write)

**Limit/DCA order flow:** TriggerClient auth (challenge → Signer.signMessage → verify) → TriggerClient.checkMints → ensureVault → craftDeposit → Signer.signTransaction → createPriceOrder/createDcaOrder (server broadcasts the deposit)

**Rewards claim flow:** RewardsClient.getClaimTransaction → Signer.signTransaction → RewardsClient.postClaim (server broadcasts)

**Gacha pack flow:** GachaClient.generatePack → Signer.signTransaction → GachaClient.submitPack → GachaClient.openPack

**Gacha marketplace flow:** GachaClient.buildMarketplaceTx → Signer.signTransaction → GachaClient.broadcast

**Gacha shipping flow:** GachaClient.getShippingNonce → Signer.signMessage → GachaClient.verifyShippingSignIn → bearer-token reads, estimate/prepare → Signer.signTransaction → GachaClient.submitShipping

**Gift flow:** InviteCode.generate → InviteClient.craftInvite → InviteCode.sign (gift keypair) → Signer.signTransaction → InviteClient.execute

**Stake flow:** StakeClient.craft (craft-*) → Signer.signTransaction → StakeClient.execute; JupSOL uses liquid/order → liquid/execute and delayed-unstake/order → delayed-unstake/execute

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
