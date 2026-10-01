# Rewards

Reward campaigns from the jup.ag Rewards hub. Reads need no key; `claim` needs an active key. See [setup](setup.md).

## Commands

### Browse campaigns

```bash
jup rewards campaigns
jup rewards campaigns --status live
jup rewards campaigns --status ended
jup rewards campaigns --campaign tessera
```

- `--status`: `all` (default), `live`, `ended`. `live` lists every campaign that hasn't ended, including upcoming and claim-only ones (same as the jup.ag "Live" tab). `ongoing` is accepted as an alias for `live`.
- `--campaign` looks up one campaign by slug or ID and adds `description`, `canClaim`, `hasLeaderboard`, `periods` (round IDs for volume-leaderboard campaigns), and the raw `reward` and `rewardsPool` objects. It can't be combined with `--status`.
- `status` is one of `upcoming`, `ongoing`, `pending_claim`, `claim_only`, `ended`.
- `rewardType` `redirect` campaigns link elsewhere (`redirectUrl`) and have no progress, leaderboard or claim.

```js
// Example JSON response:
{
  "campaigns": [
    {
      "slug": "tessera",
      "id": "48d58b14a2f04e0bab65da21b69d2778",
      "title": "Trade Tessera. Collect the cards.",
      "status": "ended",
      "rewardType": "lootbox", // lootbox, retroactive, volume-leaderboard, trading-competition-volume-vs, free-mystery-reward, redirect
      "template": "lootbox",
      "rewardName": "JupUSD",
      "rewardMint": "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
      "poolUsd": 25000,
      "remainingPoolUsd": 23462,
      "startsAt": "2026-07-01T15:00:00.000Z",
      "endsAt": "2026-07-15T10:00:00.000Z",
      "claimStartsAt": "2026-07-01T15:00:00.000Z",
      "claimEndsAt": "2026-07-29T10:00:00.000Z",
      "redirectUrl": null
    }
  ]
}
```

### View rankings

```bash
jup rewards leaderboard --campaign tessera
jup rewards leaderboard --campaign dominion-silver --period 2
jup rewards leaderboard --campaign european-final --limit 5
```

- The shape depends on the campaign (`kind`):
  - `earnings` (lootbox, retroactive, raffle): `entries` of `{ rank, address, openedBoxes, earningsUsd }` for lootbox, `{ rank, address, amount }` for retroactive (token amount), `{ rank, address, amount, numEntries }` for raffles.
  - `volume` (volume-leaderboard): one round at a time; `--period` picks the round (defaults to the current one, else the first). `periods` lists the round IDs, including the overall one. `entries` are `{ rank, address, points, multiplier, prize }`, with `prize` in the reward token (`rewardMint`).
  - `teams` (team trading competitions): `teams[]` of `{ name, mint, entries: [{ rank, address, volumeUsd }] }` plus the `bonus` raffle.
- `--limit` caps entries per list (default 10).

```js
// Example JSON response (volume):
{
  "campaign": "dominion-silver",
  "kind": "volume",
  "period": { "id": "1", "startTime": "2026-08-13T14:00:00Z", "endTime": "2026-08-20T14:00:00Z" },
  "periods": [
    { "id": "1", "label": "Round 1", "startTime": "2026-08-13T14:00:00Z", "endTime": "2026-08-20T14:00:00Z" },
    { "id": "2", "label": "Round 2", "startTime": "2026-08-20T14:00:00Z", "endTime": "2026-08-27T14:00:00Z" },
    { "id": "3", "label": "Overall", "startTime": "2026-08-13T14:00:00.000Z", "endTime": "2026-08-27T14:00:00.000Z" }
  ],
  "prizePool": 10000,
  "rewardMint": "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
  "entries": [
    { "rank": 1, "address": "72Tp...va1T", "points": 2174757.47, "multiplier": 1.01, "prize": 1631.76 }
  ]
}
```

### View wallet progress

```bash
jup rewards progress --campaign tessera
jup rewards progress --campaign tessera --address <wallet-address>
```

- With no options, uses the active key's wallet. `--key` and `--address` are mutually exclusive.
- `claimable` is true when the campaign is in its claim window (see [claim](#claim-rewards)) and the wallet has unopened cards or an unclaimed amount.
- Fields depend on `rewardType`: lootbox campaigns report `openedBoxes`, `unopenedBoxes`, `progressPct` (toward the next card), `threshold` and `earningsUsd`; token campaigns report `unclaimedAmount` and `claimedAmount` (token amounts); volume-leaderboard campaigns add per-round `stats`.

```js
// Example JSON response (lootbox):
{
  "campaign": "tessera",
  "address": "98Ht...cNwM",
  "status": "ended",
  "claimable": false,
  "rewardMint": "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
  "rewardType": "lootbox",
  "rank": 1,
  "rankPct": 0.44,
  "openedBoxes": 68,
  "unopenedBoxes": 0,
  "selfBoxes": 68,
  "referralBoxes": 0,
  "progressPct": 68.36,
  "threshold": 3000,
  "earningsUsd": 407,
  "updatedAt": "2026-07-15T10:00:00.000Z"
}
```

### View unclaimed rewards

```bash
jup rewards unclaimed
jup rewards unclaimed --address <wallet-address>
```

```js
// Example JSON response:
{
  "address": "5AWh...Ai5i",
  "earnedUsd": 453533.18, // lifetime rewards earned
  "referralEarnedUsd": 0,
  "unclaimedUsd": 338113.83,
  "rewards": [
    {
      "campaign": "asr-2026-q2",
      "title": "Active Staking Rewards (ASR) Apr - Jun 2026",
      "type": "token", // "token" or "lootbox"
      "unopenedBoxes": null, // lootbox only
      "mint": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "symbol": "JUP",
      "amount": 1025686.889866,
      "valueUsd": 338113.83
    }
  ]
}
```

### Claim rewards

```bash
jup rewards claim --campaign <slug>
jup rewards claim --campaign <slug> --boxes 5
jup rewards claim --campaign <slug> --key mykey
```

- Claims the full unclaimed amount for token campaigns. For lootbox campaigns it reveals mystery cards: `--boxes` sets how many (defaults to all unopened).
- Fails unless the campaign is in its claim window, like jup.ag: a campaign whose reward pool is used up still lets you claim what you earned, and fixed campaigns with no `claimEndsAt` stay claimable once claiming starts.
- Campaigns whose `reward.onlyClaimableThroughJup` is true can only be claimed from a Jupiter wallet, so the CLI refuses and points to the campaign page on jup.ag.
- The server builds the transaction; the CLI signs it and the server broadcasts it.
- `--dry-run` returns the unsigned `transaction` without signing or submitting.

```js
// Example JSON response:
{
  "campaign": "tessera",
  "address": "98Ht...cNwM",
  "rewardType": "lootbox",
  "claimUntilBox": 70, // lootbox only: cards revealed after this claim
  "expectedAmount": null, // token campaigns: unclaimed token amount
  "valueUsd": 12,
  "claimed": [
    { "mint": "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD", "amount": 12, "valueUsd": 12 }
  ],
  "signature": "4xK9..."
}
```

### Apply for a campaign

Sends the jup.ag "Launch a campaign" enquiry for your token.

```bash
jup rewards apply --project "My Project" --token <mint> --contact-method twitter --contact @myproject
jup rewards apply --project "My Project" --token <mint> --contact-method email --contact team@myproject.xyz --goals "Grow holders"
```

- `--contact-method`: `twitter`, `telegram`, `email`, `discord`. Handles can't be URLs; emails must be valid.
- `--dry-run` validates and prints the application without sending it.

```js
// Example JSON response:
{
  "submitted": true,
  "application": {
    "projectName": "My Project",
    "tokenMintAddress": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "contactMethod": "twitter",
    "contactValue": "@myproject",
    "campaignGoals": "Grow holders"
  }
}
```
