import { getBase58Decoder, isOffCurveAddress, type Address } from "@solana/kit";

import { WALLET, type ParityCase } from "../types.ts";

// Stake account states, live gifts and JupSOL holders change by the hour, so
// tx cases pick a wallet that holds what the action needs at run time.

const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
const INVITE_PROGRAM = "inv1tEtSwRMtM44tbvJGNiTxMvDfPVnX9StyqXfDfks";
const JUPITER_VOTE = "CatzoSMUkTRidT5DwBxAC2pEtnwMBTpkCepHkFgZDiqb";
const JUPSOL = "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";
const RICH_WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const GIFT_HISTORY_WALLET = "HFGRdFEtBBRatERRTrsLg6FeZobBHY2tLiuqTxiXWTW6";
const JUP_STAKER_DEMO = "jupE53639uCTuXk3VgRmUuDoafR9baGfLZf4T5DBH5H";
const MIN_FEE_LAMPORTS = 10_000_000;
const U64_MAX = 18446744073709551615n;

const base58 = getBase58Decoder();

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429) {
      await Bun.sleep(2000 * (attempt + 1));
      continue;
    }
    const body = (await res.json()) as { result?: T; error?: unknown };
    if (body.error) {
      throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    }
    return body.result as T;
  }
  throw new Error(`${method}: rate limited`);
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await Bun.sleep(3000 * (attempt + 1));
      continue;
    }
    return (await res.json()) as T;
  }
  throw new Error(`${url}: rate limited`);
}

async function balances(owners: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < owners.length; i += 100) {
    const chunk = owners.slice(i, i + 100);
    const res = await rpc<{ value: ({ lamports: number } | null)[] }>(
      "getMultipleAccounts",
      [chunk, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]
    );
    chunk.forEach((o, j) => out.set(o, res.value[j]?.lamports ?? 0));
  }
  return out;
}

type StakeApiAccount = {
  address: string;
  capabilities: {
    canDeactivate: boolean;
    canReactivate: boolean;
    canWithdraw: boolean;
    canSplit: boolean;
    maxSplitLamports: string | null;
    canDepositToPool: boolean;
    mergeableWith: string[];
  };
};

async function stakeAccounts(owner: string): Promise<StakeApiAccount[]> {
  const res = await getJson<{ accounts?: StakeApiAccount[] }>(
    `https://api.jup.ag/stake/v1/accounts?walletAddress=${owner}`
  );
  return res.accounts ?? [];
}

type OnChainStake = { owner: string; deact: bigint | null };

async function jupiterStakeAccounts(): Promise<OnChainStake[]> {
  const res = await rpc<{ account: { data: [string, string] } }[]>(
    "getProgramAccounts",
    [
      STAKE_PROGRAM,
      {
        encoding: "base64",
        dataSlice: { offset: 44, length: 136 },
        filters: [
          { dataSize: 200 },
          { memcmp: { offset: 124, bytes: JUPITER_VOTE } },
        ],
      },
    ]
  );
  return res.map(({ account }) => {
    const b = Buffer.from(account.data[0], "base64");
    const deact = b.readBigUInt64LE(128);
    return {
      owner: base58.decode(b.subarray(0, 32)),
      deact: deact === U64_MAX ? null : deact,
    };
  });
}

async function pickStakeOwner(
  candidates: string[],
  want: (accounts: StakeApiAccount[]) => StakeApiAccount | undefined
): Promise<{ owner: string; account: StakeApiAccount } | null> {
  const lamports = await balances(candidates.slice(0, 200));
  const funded = candidates.filter(
    (o) => (lamports.get(o) ?? 0) >= MIN_FEE_LAMPORTS
  );
  for (const owner of funded.slice(0, 4)) {
    const account = want(await stakeAccounts(owner));
    if (account) {
      return { owner, account };
    }
  }
  return null;
}

async function findStakeFixtures() {
  const { epoch } = await rpc<{ epoch: number }>("getEpochInfo", []);
  const all = await jupiterStakeAccounts();
  const byOwner = new Map<string, OnChainStake[]>();
  for (const s of all) {
    byOwner.set(s.owner, [...(byOwner.get(s.owner) ?? []), s]);
  }
  const owners = [...byOwner.entries()];
  const ownersWith = (pred: (s: OnChainStake[]) => boolean) =>
    owners.filter(([, s]) => pred(s)).map(([o]) => o);

  const manage = await pickStakeOwner(
    ownersWith((s) => s.filter((x) => x.deact === null).length >= 2),
    (accs) =>
      accs.find(
        (a) =>
          a.capabilities.canDeactivate &&
          a.capabilities.canSplit &&
          BigInt(a.capabilities.maxSplitLamports ?? 0) >= 1_000_000_000n &&
          a.capabilities.canDepositToPool &&
          a.capabilities.mergeableWith.length > 0
      )
  );
  const reactivate = await pickStakeOwner(
    ownersWith((s) => s.some((x) => x.deact === BigInt(epoch))),
    (accs) => accs.find((a) => a.capabilities.canReactivate)
  );
  const withdraw = await pickStakeOwner(
    ownersWith((s) => s.some((x) => x.deact !== null && x.deact < epoch)),
    (accs) => accs.find((a) => a.capabilities.canWithdraw)
  );
  return { manage, reactivate, withdraw };
}

async function findPendingGift(): Promise<{
  sender: string;
  invite: string;
} | null> {
  const accounts = await rpc<
    { pubkey: string; account: { data: [string, string] } }[]
  >("getProgramAccounts", [
    INVITE_PROGRAM,
    { encoding: "base64", dataSlice: { offset: 8, length: 32 } },
  ]);
  const senders = [
    ...new Set(
      accounts.map((a) =>
        base58.decode(Buffer.from(a.account.data[0], "base64"))
      )
    ),
  ];
  const lamports = await balances(senders);
  const funded = senders
    .filter((s) => (lamports.get(s) ?? 0) >= MIN_FEE_LAMPORTS)
    .sort((a, b) => (lamports.get(b) ?? 0) - (lamports.get(a) ?? 0));
  const soon = Date.now() / 1000 + 3600;
  for (const sender of funded.slice(0, 5)) {
    await Bun.sleep(1000);
    const { invites } = await getJson<{
      invites: { invite_pda: string; expiry: string }[];
    }>(
      `https://lite-api.jup.ag/ultra/v1/invite/pending?address=${sender}&page=1&pageSize=10`
    );
    const live = invites?.find((i) => Number(i.expiry) > soon);
    if (live) {
      return { sender, invite: live.invite_pda };
    }
  }
  return null;
}

async function findJupsolHolder(): Promise<string | null> {
  const { holders } = await getJson<{
    holders: { address: string; amount: number; solBalanceDisplay: number }[];
  }>(`https://datapi.jup.ag/v1/holders/${JUPSOL}`);
  // Large holders are often program vaults (off-curve), which cannot sign.
  return (
    holders.find(
      (h) =>
        h.amount > 10 &&
        h.solBalanceDisplay > 0.1 &&
        !isOffCurveAddress(h.address as Address)
    )?.address ?? null
  );
}

// A missing fixture must not pass silently: the case runs a bogus command, so
// the harness reports FAIL with the reason in the error.
const unavailable = (feature: string, id: string, why: string): ParityCase => ({
  id,
  feature,
  kind: "read",
  args: [`no-fixture: ${why}`.replaceAll(" ", "-")],
});

async function settle<T>(fallback: T, lookup: () => Promise<T>): Promise<T> {
  try {
    return await lookup();
  } catch (err) {
    console.error(`fixture lookup failed: ${err}`);
    return fallback;
  }
}

// Fixture lookups hit RPC and rate-limited APIs, so only run them when this
// area's cases will actually execute, one after another to limit bursts.
const areaArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const willRun =
  !process.argv.includes("--coverage") &&
  (areaArgs.length === 0 || areaArgs.includes("portfolio-stake"));

const noStake = { manage: null, reactivate: null, withdraw: null };
const stake = willRun ? await settle(noStake, findStakeFixtures) : noStake;
const gift = willRun ? await settle(null, findPendingGift) : null;
const jupsolHolder = willRun ? await settle(null, findJupsolHolder) : null;

const nonEmpty =
  (key: string) =>
  (json: unknown): boolean => {
    const value = (json as Record<string, unknown>)[key];
    return Array.isArray(value) && value.length > 0;
  };

const stakeTx = (
  id: string,
  fixture: { owner: string; account: StakeApiAccount } | null,
  args: (account: StakeApiAccount) => string[]
): ParityCase =>
  fixture
    ? {
        id,
        feature: "stake-manage",
        kind: "tx",
        wallet: fixture.owner,
        args: ["stake", "native", ...args(fixture.account)],
      }
    : unavailable("stake-manage", id, "no funded wallet in that stake state");

export const cases: ParityCase[] = [
  // Portfolio
  {
    id: "positions-public-address",
    feature: "portfolio-public-search",
    kind: "read",
    args: ["portfolio", "positions", "--address", JUP_STAKER_DEMO],
    expect: nonEmpty("positions"),
  },
  {
    id: "positions-demo-single",
    feature: "portfolio-demo-single",
    kind: "read",
    args: ["portfolio", "positions", "--address", "jup-staker"],
    expect: nonEmpty("positions"),
  },
  {
    id: "positions-demo-group",
    feature: "portfolio-demo-group",
    kind: "read",
    args: ["portfolio", "positions", "--address", "demo"],
    expect: (json) =>
      (json as { wallets?: unknown[] }).wallets?.length === 3 &&
      nonEmpty("positions")(json),
  },
  {
    id: "positions-own-wallet",
    feature: "portfolio-tabs",
    kind: "read",
    args: ["portfolio", "positions"],
    wallet: JUP_STAKER_DEMO,
    expect: nonEmpty("positions"),
  },
  {
    id: "spot-pnl",
    feature: "portfolio-tabs",
    kind: "read",
    args: ["portfolio", "pnl", "--address", JUP_STAKER_DEMO],
    expect: (json) => "total" in ((json as { stats?: object }).stats ?? {}),
  },
  {
    id: "addressbook-add",
    feature: "portfolio-address-book",
    kind: "read",
    wallet: JUP_STAKER_DEMO,
    args: [
      "portfolio",
      "addressbook",
      "add",
      "--name",
      "parity-wallet",
      "--address",
      JUP_STAKER_DEMO,
      "--group",
      "parity-group",
    ],
    expect: nonEmpty("groups"),
  },
  {
    id: "addressbook-group-view",
    feature: "portfolio-address-book",
    kind: "read",
    wallet: JUP_STAKER_DEMO,
    args: ["portfolio", "positions", "--address", "parity-group"],
    expect: nonEmpty("positions"),
  },
  {
    id: "addressbook-remove",
    feature: "portfolio-address-book",
    kind: "read",
    wallet: JUP_STAKER_DEMO,
    args: ["portfolio", "addressbook", "remove", "--name", "parity-wallet"],
    expect: (json) => (json as { wallets?: unknown[] }).wallets?.length === 0,
  },
  {
    id: "airdrop-checker",
    feature: "portfolio-airdrop-checker",
    kind: "unsupported",
    reason:
      "`jup portfolio airdrops` calls api.jup.ag/portfolio/v2/airdrop-checker, which answers 403 'Endpoint access not available for this organization' without an org-enabled API key (no v1 route exists); works when the configured key has Portfolio v2 access",
  },

  // Send / gift
  {
    id: "receive",
    feature: "send-tabs",
    kind: "read",
    args: ["deposit", "receive"],
    expect: nonEmpty("depositAddresses"),
  },
  {
    id: "gift-create-sol",
    feature: "send-gift",
    kind: "tx",
    wallet: RICH_WALLET,
    args: ["gift", "create", "--token", "SOL", "--amount", "0.01"],
  },
  gift
    ? {
        id: "gift-clawback",
        feature: "send-gift",
        kind: "tx",
        wallet: gift.sender,
        args: ["gift", "clawback", "--invite", gift.invite],
      }
    : unavailable(
        "send-gift",
        "gift-clawback",
        "no live gift with a funded sender"
      ),
  gift
    ? {
        id: "gift-pending",
        feature: "send-gift",
        kind: "read",
        args: ["gift", "pending", "--address", gift.sender],
        expect: nonEmpty("gifts"),
      }
    : unavailable("send-gift", "gift-pending", "no live gift"),
  {
    id: "gift-history",
    feature: "send-gift",
    kind: "read",
    args: ["gift", "history", "--address", GIFT_HISTORY_WALLET, "--limit", "5"],
    expect: nonEmpty("gifts"),
  },
  {
    id: "gift-claim",
    feature: "send-gift",
    kind: "unsupported",
    reason:
      "`jup gift claim --code` is implemented, but simulating it needs a real unclaimed gift code, which only its recipient holds",
  },

  // Deposit
  {
    id: "onramp",
    feature: "deposit-methods",
    kind: "read",
    args: ["deposit", "onramp"],
    expect: (json) =>
      String((json as { url?: string }).url).startsWith(
        "https://buy.onramper.com/"
      ),
  },
  {
    id: "deposit-addresses",
    feature: "deposit-methods",
    kind: "read",
    args: ["deposit", "receive", "--address", WALLET],
    expect: nonEmpty("depositAddresses"),
  },
  {
    id: "cex",
    feature: "deposit-methods",
    kind: "unsupported",
    reason:
      "CEX transfer runs in the Mesh Connect browser SDK (link token from jup.ag/api/mesh/link-token); the CLI equivalent is withdrawing from the exchange to `jup deposit receive`",
  },
  {
    id: "bridge-tokens",
    feature: "deposit-bridge",
    kind: "read",
    args: [
      "deposit",
      "bridge-tokens",
      "--chain",
      "ethereum",
      "--search",
      "USDC",
    ],
    expect: (json) => Array.isArray(json) && json.length > 0,
  },
  {
    id: "bridge-quote",
    feature: "deposit-bridge",
    kind: "read",
    args: [
      "deposit",
      "bridge-quote",
      "--from-chain",
      "ethereum",
      "--from-token",
      "USDC",
      "--to-token",
      "USDC",
      "--amount",
      "100",
    ],
    expect: nonEmpty("routes"),
  },
  {
    id: "bridge-execute",
    feature: "deposit-bridge",
    kind: "unsupported",
    reason:
      "jup.ag hands bridge execution to the Universal Swap and deBridge browser widgets and calls no transaction endpoint; the CLI quotes routes only",
  },

  // Stake
  {
    id: "stake-info",
    feature: "stake-native",
    kind: "read",
    args: ["stake", "info"],
    expect: (json) =>
      typeof (json as { validator?: { apyPct?: unknown } }).validator
        ?.apyPct === "number",
  },
  {
    id: "stake-native-deposit",
    feature: "stake-native",
    kind: "tx",
    wallet: RICH_WALLET,
    args: ["stake", "native", "deposit", "--amount", "1"],
  },
  {
    id: "jupsol-deposit",
    feature: "stake-liquid",
    kind: "tx",
    wallet: RICH_WALLET,
    args: ["stake", "jupsol", "deposit", "--amount", "0.1"],
  },
  ...(jupsolHolder
    ? ([
        {
          id: "jupsol-withdraw-native",
          feature: "stake-liquid",
          kind: "tx",
          wallet: jupsolHolder,
          args: [
            "stake",
            "jupsol",
            "withdraw",
            "--amount",
            "2",
            "--mode",
            "native",
          ],
        },
        {
          id: "jupsol-withdraw-delayed",
          feature: "stake-liquid",
          kind: "tx",
          wallet: jupsolHolder,
          args: [
            "stake",
            "jupsol",
            "withdraw",
            "--amount",
            "1",
            "--mode",
            "delayed",
          ],
        },
      ] satisfies ParityCase[])
    : [
        unavailable(
          "stake-liquid",
          "jupsol-withdraw",
          "no funded JupSOL holder"
        ),
      ]),
  stake.manage
    ? {
        id: "stake-accounts",
        feature: "stake-manage",
        kind: "read",
        args: ["stake", "accounts", "--address", stake.manage.owner],
        expect: nonEmpty("accounts"),
      }
    : unavailable("stake-manage", "stake-accounts", "no stake owner"),
  stake.manage
    ? {
        id: "stake-rewards",
        feature: "stake-manage",
        kind: "read",
        args: [
          "stake",
          "rewards",
          "--stake-account",
          stake.manage.account.address,
          "--limit",
          "3",
        ],
        expect: (json) =>
          Array.isArray((json as { rewards?: unknown }).rewards),
      }
    : unavailable("stake-manage", "stake-rewards", "no stake account"),
  stakeTx("stake-deactivate", stake.manage, (a) => [
    "deactivate",
    "--stake-account",
    a.address,
  ]),
  stakeTx("stake-split", stake.manage, (a) => [
    "split",
    "--stake-account",
    a.address,
    "--raw-amount",
    "1000000000",
  ]),
  stakeTx("stake-merge", stake.manage, (a) => [
    "merge",
    "--stake-account",
    a.address,
    "--sources",
    a.capabilities.mergeableWith[0]!,
  ]),
  stakeTx("stake-convert-jupsol", stake.manage, (a) => [
    "convert",
    "--stake-account",
    a.address,
  ]),
  stakeTx("stake-reactivate", stake.reactivate, (a) => [
    "reactivate",
    "--stake-account",
    a.address,
  ]),
  stakeTx("stake-withdraw", stake.withdraw, (a) => [
    "withdraw",
    "--stake-account",
    a.address,
  ]),
];
