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

**Entry point:** `src/index.ts` — initializes config, registers 13 command groups with Commander.

**Commands** (`src/commands/`): Static classes that register subcommands. Each delegates to library modules.

- `ConfigCommand` — `config list`, `config set`
- `DepositCommand` — `deposit receive/onramp/bridge-tokens/bridge-quote`
- `GiftCommand` — `gift create/claim/info/clawback/pending/history`
- `KeysCommand` — `keys list/add/delete/edit/use/solana-import`
- `LendCommand` — `lend earn tokens/positions/deposit/withdraw`
- `PerpsCommand` — `perps positions/markets/open/set/close`
- `PortfolioCommand` — `portfolio positions/pnl/airdrops`, `portfolio addressbook list/add/remove`
- `PredictionsCommand` — `predictions events/positions/open/close/history`
- `SignCommand` — `sign --tx <base64>`
- `SpotCommand` — `spot tokens/quote/swap/portfolio/transfer/reclaim`
- `StakeCommand` — `stake info/accounts/rewards`, `stake native deposit/deactivate/reactivate/withdraw/split/merge/convert`, `stake jupsol deposit/withdraw`
- `UpdateCommand` — `update` (self-update CLI to latest version)
- `VrfdCommand` — `vrfd check/submit`

**Libraries** (`src/lib/`):

- `Asset` — token metadata (mint addresses, decimals) for SOL, BTC, ETH, USDC; `resolveAsset()` for name lookup
- `Config` — manages `~/.config/jup/settings.json` (activeKey, output format, API key)
- `Signer` — loads keypairs from `~/.config/jup/keys/{name}.json`, signs transactions
- `KeyPair` — generates/recovers keypairs (BIP39 mnemonics, BIP32 derivation)
- `Output` — renders data as table (via cli-table3) or JSON based on config; also provides display formatters (`formatDollar`, `formatBoolean`, `formatPercentageChange`)
- `NumberConverter` — converts between human-readable and on-chain decimal amounts
- `Swap` — shared swap execution logic used by SpotCommand and LendCommand
- `AddressBook` — saved wallets and groups in `~/.config/jup/addressbook.json`; resolves `--address` lists (incl. built-in `demo` wallets)
- `InviteCode` — gift codes: generation and the `sha256("invite:" + code)` gift keypair, compatible with jup.ag/gift links
- `PortfolioPositions` — normalizes Portfolio API elements (v1 and v2) into one position shape

**API Clients** (`src/clients/`):

- `DatapiClient` — Jupiter token data/search API
- `UltraClient` — Jupiter Ultra swap API (quote + execute)
- `PerpsClient` — Jupiter Perps API v2 (positions, orders, TP/SL)
- `LendClient` — Jupiter Lend API (earn tokens, positions, earnings)
- `PredictionsClient` — Jupiter Predictions API v1 (events, positions, orders, history)
- `VrfdClient` — Jupiter Token Verification API (eligibility check, payment, execute)
- `PortfolioClient` — Jupiter Portfolio API (`api.jup.ag/portfolio` v1, or v2 with a key that has access; airdrop checker) and datapi spot PnL
- `InviteClient` — Ultra gift (invite) API: craft-invite/claim/clawback, execute, info, pending, history
- `StakeClient` — Jupiter Stake API (`api.jup.ag/stake/v1`): stake accounts, craft-* + execute, JupSOL liquid/delayed-unstake orders
- `DepositClient` — jup.ag/api proxies: universal deposit addresses, onramp URL, bridge tokens and quotes

**Spot swap flow:** token search → Swap.execute → UltraClient.getOrder → Signer.signTransaction → UltraClient.postExecute

**Perps flow:** PerpsClient.post* → Signer.signTransaction → PerpsClient.postExecute

**Lend deposit/withdraw flow:** LendClient.getTokens → resolve jlToken → Swap.execute → LendClient.getPositions (updated state)

**Predictions flow:** PredictionsClient.postOrder → Signer.signTransaction → PredictionsClient.postExecute

**Gift flow:** InviteCode.generate → InviteClient.craftInvite → InviteCode.sign (gift keypair) → Signer.signTransaction → InviteClient.execute

**Stake flow:** StakeClient.craft (craft-*) → Signer.signTransaction → StakeClient.execute; JupSOL uses liquid/order → liquid/execute and delayed-unstake/order → delayed-unstake/execute

**Vrfd flow:** VrfdClient.checkEligibility → VrfdClient.craftTxn → Signer.signTransaction → VrfdClient.execute

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
