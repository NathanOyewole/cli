# Gifts

Send tokens as a link that anyone can claim, the same gifts as jup.ag/send. Unclaimed gifts expire after 7 days; the sender can cancel ("claw back") any unclaimed gift.

Requires: an active key for `create`, `claim` and `clawback`. See [setup](setup.md).

The gift code is the only secret: whoever has the code or link can claim the funds. The CLI derives the gift's signing keypair from the code exactly like jup.ag (`sha256("invite:" + code)`), so links work in both.

`create`, `claim` and `clawback` report `status: "pending"` when Jupiter broadcast the transaction but hasn't confirmed it yet; check the `signature` before retrying. If the outcome is unknown (for example a timeout), the command fails with the signature in the error.

## Commands

### Create a gift

```bash
jup gift create --token SOL --amount 0.1
jup gift create --token USDC --amount 5 --key mykey
jup gift create --token <mint> --raw-amount 1000000 --dry-run
```

- `--token` resolves against tokens in your wallet (symbol or mint)
- Exactly one of `--amount` or `--raw-amount` is required
- Share `link` privately: it is the claim link
- `--dry-run` returns the `transaction` already signed by the gift keypair; it needs only the sender's signature
- Before submitting, the link is written to stderr so it survives a timeout or crash. If submitting fails, the error repeats the link and includes the transaction signature

```js
// Example JSON response:
{
  "sender": "5tz...Ai9",
  "code": "5Wm4yQeafHYeMjT61pAx", // secret
  "link": "https://jup.ag/gift#code=5Wm4yQeafHYeMjT61pAx", // secret
  "invite": "5AND...wpHp", // gift account address, used by clawback
  "inviteSigner": "DP2x...cZ9s",
  "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "amount": "1",
  "valueUsd": 0.9998,
  "networkFeeLamports": 2758581,
  "expiresAt": "2026-10-08T00:18:39.000Z",
  "signature": "3dV98zG...",
  "status": "confirmed" // "pending" if not confirmed yet; null in dry-run
}
```

### Check a gift

```bash
jup gift info --code <code-or-link>
```

```js
// Example JSON response:
{
  "invite": "SAB8...xoz2",
  "inviteSigner": "CCxn...dt7r",
  "token": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "amount": "0.05",
  "valueUsd": 5.89,
  "expiresAt": "2026-10-03T18:34:11.000Z"
}
```

### Claim a gift

```bash
jup gift claim --code <code-or-link>
jup gift claim --code "https://jup.ag/gift#code=..." --key mykey
```

```js
// Example JSON response:
{
  "receiver": "BQ7...GQDV",
  "invite": "SAB8...xoz2",
  "token": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "amount": "0.05",
  "valueUsd": 5.89,
  "signature": "3dV98zG...",
  "status": "confirmed"
}
```

### Cancel a gift

```bash
jup gift clawback --invite <gift-address>
jup gift clawback --code <code-or-link>
```

- Returns the funds of an unclaimed gift to the sender. Use the `invite` address from `jup gift pending`, or the code.

```js
// Example JSON response:
{
  "sender": "3wrd...fDAK",
  "invite": "9ENt...hxe",
  "token": { "id": "HiNE...pump", "symbol": "FERT", "decimals": 6 },
  "amount": "45977.314229",
  "signature": "3dV98zG...",
  "status": "confirmed"
}
```

### List gifts

```bash
jup gift pending
jup gift history --limit 20
jup gift history --address <wallet-address> --offset 10
```

- `pending` lists unclaimed gifts you sent; `history` lists claimed, cancelled and expired ones
- `--offset` must be a multiple of `--limit`; `next` is the offset of the next page, or `null`

```js
// Example JSON response:
{
  "gifts": [
    {
      "invite": "DavX...ABC1",
      "inviteSigner": "HbmU...rGyj",
      "sender": "HFGR...WTW6",
      "receiver": "6q55...Qnn6", // null while pending
      "token": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
      "amount": "0.025780522",
      "rawAmount": "25780522",
      "status": "claimed", // pending | expired | claimed | cancelled
      "createdAt": "2026-09-30T23:43:16.000Z",
      "expiresAt": "2026-10-07T23:43:16.000Z",
      "closedAt": "2026-09-30T23:43:26.000Z", // claim or cancel time
      "signature": "5SxT...hkm", // creation tx
      "closeSignature": "g1NN...iqBW" // claim or cancel tx
    }
  ],
  "next": 10
}
```

To send to an address instead of a link, use `jup spot transfer`. To receive, use `jup deposit receive`.
