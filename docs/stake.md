# Stake

Stake SOL with the Jupiter validator, natively or as JupSOL, and manage stake accounts. Staking JUP for governance happens at https://vote.jup.ag and is not part of the CLI.

Requires: an active key for every command except `info`, `accounts --address` and `rewards`. See [setup](setup.md).

Transactions are built by the Jupiter Stake API (`api.jup.ag/stake/v1`), which works without an API key at a low rate limit. All write commands support `--dry-run`, which returns the unsigned `transaction`.

## Commands

### Validator and JupSOL stats

```bash
jup stake info
```

```js
// Example JSON response:
{
  "validator": {
    "voteAccount": "Catz...iqb",
    "apyPct": 4.87, // 4.87 means 4.87%
    "maxApyPct": 6.87, // jup.ag shows the APY as the range apyPct to maxApyPct
    "commissionPct": 5,
    "activatedStake": "11206135.295149814", // SOL
    "delinquent": false
  },
  "jupsol": {
    "mint": "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    "pool": "8VpR...4KCtr",
    "solPerJupsol": 1.211994,
    "totalStaked": "5162360.392929583", // SOL
    "instantUnstakeCapacity": "4505115.981689605", // SOL available for `jupsol withdraw --mode native`
    "withdrawalFeePct": 0.1,
    "minimumDelegation": "1" // SOL
  }
}
```

### List stake accounts

```bash
jup stake accounts
jup stake accounts --address <wallet-address>
```

- Shows each stake account's state and which actions it allows (the jup.ag Manage tab)
- SOL amounts are human-readable strings

```js
// Example JSON response:
{
  "epoch": 1046,
  "minimumDelegation": "1",
  "accounts": [
    {
      "stakeAccount": "17qn...aiTT",
      "status": "Active", // Active | Activating | Deactivating | Inactive
      "balance": "40.162594851", // active + inactive SOL
      "activeStake": "40.153452763",
      "inactiveStake": "0.009142088",
      "voteAccount": "Catz...iqb",
      "validatorName": "Jupiter",
      "isJupiterValidator": true,
      "activationEpoch": 981,
      "deactivationEpoch": null,
      "canDeactivate": true,
      "canReactivate": false,
      "canWithdraw": false,
      "canSplit": true,
      "maxSplit": "39.153452763",
      "canConvert": true, // can convert to JupSOL
      "mergeableWith": ["1ha4...dtA"]
    }
  ]
}
```

### Staking rewards

```bash
jup stake rewards --stake-account <address>
jup stake rewards --stake-account <address> --limit 20 --before-epoch 1040
```

```js
// Example JSON response:
{
  "rewards": [{ "epoch": 1045, "amount": "0.010523", "date": "2026-09-29T10:12:00.000Z" }],
  "next": "1036" // pass as --before-epoch for the next page; null at the end
}
```

### Native staking

```bash
jup stake native deposit --amount 5
jup stake native deactivate --stake-account <address>
jup stake native reactivate --stake-account <address>
jup stake native withdraw --stake-account <address>
jup stake native split --stake-account <address> --amount 2
jup stake native merge --stake-account <destination> --sources <address>,<address>
jup stake native convert --stake-account <address>
jup stake native convert --stake-account <address> --amount 2
```

- `deposit` stakes SOL to the Jupiter validator in a new stake account (minimum 1 SOL)
- `deactivate` unstakes; the account becomes withdrawable after the epoch ends. `reactivate` undoes a deactivation in the same epoch.
- `withdraw` closes an inactive account and returns its SOL to the wallet
- `split` moves `--amount` SOL into a new stake account
- `merge` merges `--sources` into `--stake-account`; see `mergeableWith` in `stake accounts`
- `convert` turns a Jupiter-validator stake account into JupSOL. `--amount` converts part of it.
- Amounts are SOL (`--amount`) or lamports (`--raw-amount`)

```js
// Example JSON response (split):
{
  "action": "split", // stake | deactivate | reactivate | withdraw | split | merge | deposit-pool | withdraw-pool
  "wallet": "C2RF...g1Gn",
  "stakeAccount": "17qn...aiTT",
  "newStakeAccount": "C7Tf...Bjiy",
  "amount": "2",
  "signature": "3dV98zG..."
}
```

Other actions return the fields that apply: `deposit` returns the new `stakeAccount`, `amount` and `rentLamports`; `merge` returns `mergedStakeAccounts`; `convert` returns `amount` (null for the whole account) and `outAmount` (JupSOL received).

### JupSOL

```bash
jup stake jupsol deposit --amount 1
jup stake jupsol withdraw --amount 2
jup stake jupsol withdraw --amount 2 --mode delayed
jup stake jupsol withdraw --amount 2 --mode delayed --validator <vote-account>
```

- `deposit` stakes SOL for JupSOL
- `withdraw` unstakes JupSOL into a stake account, like jup.ag's "To Native Stake" and "Delayed Unstake":
  - `--mode native` (default) gives a stake account at the Jupiter validator, limited by `instantUnstakeCapacity`
  - `--mode delayed` gives a stake account at `--validator` (default Jupiter), with a 0.1% fee. Deactivate and withdraw it to get SOL.
- To swap JupSOL to SOL instantly, use `jup spot swap --from JupSOL --to SOL`

```js
// Example JSON response (jupsol deposit):
{
  "action": "jupsol-deposit", // jupsol-deposit | withdraw-pool | jupsol-delayed-unstake
  "wallet": "5tz...Ai9",
  "amount": "1", // SOL in
  "outAmount": "0.825086", // JupSOL out
  "signature": "3dV98zG..."
}
```
