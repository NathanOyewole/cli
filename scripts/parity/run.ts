import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { WALLET, type ParityCase } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");
const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DEFAULT_WALLET =
  process.env.PARITY_WALLET ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

type Verdict = "PASS" | "FAIL" | "UNSUPPORTED";
type Result = { area: string; c: ParityCase; verdict: Verdict; detail: string };

const areaFilter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const skipBuild = process.argv.includes("--no-build");

// A vault-backed keychain entry is never contacted in --dry-run, so it acts as
// a watch-only key: the CLI builds real transactions for any public wallet.
function makeHome(wallet: string): string {
  const home = mkdtempSync(join(tmpdir(), "jup-parity-"));
  const keys = join(home, ".config", "jup", "keys");
  mkdirSync(keys, { recursive: true });
  writeFileSync(
    join(keys, "watch.keychain.json"),
    JSON.stringify({
      backend: "vault",
      address: wallet,
      params: {
        vaultAddr: "https://127.0.0.1:1",
        vaultToken: "unused",
        keyName: "unused",
        publicKey: wallet,
      },
    })
  );
  writeFileSync(
    join(home, ".config", "jup", "settings.json"),
    JSON.stringify({ activeKey: "watch", output: "json" })
  );
  return home;
}

function runCli(home: string, args: string[]) {
  const { status, stdout, stderr } = spawnSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home },
    encoding: "utf-8",
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { status, stdout, stderr, json };
}

function collectTransactions(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v) => collectTransactions(v, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((k === "transaction" || k === "transactions") && isTx(v)) {
        out.push(v);
      } else if (k === "transactions" && Array.isArray(v)) {
        v.filter(isTx).forEach((t) => out.push(t));
        collectTransactions(
          v.filter((t) => !isTx(t)),
          out
        );
      } else {
        collectTransactions(v, out);
      }
    }
  }
  return out;
}

function isTx(v: unknown): v is string {
  return typeof v === "string" && v.length > 100;
}

async function simulate(tx: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [
          tx,
          {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: true,
          },
        ],
      }),
    });
    if (res.status === 429) {
      await Bun.sleep(2000 * (attempt + 1));
      continue;
    }
    const body = (await res.json()) as {
      error?: { message: string };
      result?: { value: { err: unknown; logs: string[] | null } };
    };
    if (body.error) {
      return `rpc: ${body.error.message}`;
    }
    const { err, logs } = body.result!.value;
    if (err === null) {
      return null;
    }
    const tail = (logs ?? []).filter((l) => /error|failed/i.test(l)).at(-1);
    return `${JSON.stringify(err)} ${tail ?? ""}`.trim();
  }
  return "rpc: rate limited";
}

const homes = new Map<string, string>();
function homeFor(wallet: string): string {
  if (!homes.has(wallet)) {
    homes.set(wallet, makeHome(wallet));
  }
  return homes.get(wallet)!;
}

async function check(c: ParityCase): Promise<[Verdict, string]> {
  if (c.kind === "unsupported") {
    return ["UNSUPPORTED", c.reason];
  }
  const wallet = c.wallet ?? DEFAULT_WALLET;
  const home = homeFor(wallet);
  const args = c.args.map((a) => a.replaceAll(WALLET, wallet));
  const flags = c.kind === "tx" ? ["-f", "json", "--dry-run"] : ["-f", "json"];
  let run = runCli(home, [...flags, ...args]);
  for (
    let attempt = 1;
    attempt < 5 && /rate limit/i.test(run.stdout);
    attempt++
  ) {
    await Bun.sleep(5000 * attempt);
    run = runCli(home, [...flags, ...args]);
  }
  const { status, stdout, stderr, json } = run;
  if (status !== 0 || json === undefined) {
    return [
      "FAIL",
      `exit ${status}: ${(stdout + stderr).trim().slice(0, 300)}`,
    ];
  }
  if (c.kind === "read") {
    if (c.expect && !c.expect(json)) {
      return ["FAIL", `unexpected shape: ${stdout.slice(0, 300)}`];
    }
    return ["PASS", `${stdout.length} bytes`];
  }
  const txs = collectTransactions(json);
  if (txs.length === 0) {
    return ["FAIL", `no transaction in output: ${stdout.slice(0, 300)}`];
  }
  const failures: string[] = [];
  for (const tx of txs) {
    const err = await simulate(tx);
    if (err) {
      failures.push(err);
    }
  }
  return failures.length === 0
    ? ["PASS", `${txs.length} tx simulated`]
    : ["FAIL", `simulation: ${failures.join(" | ").slice(0, 400)}`];
}

async function loadCases(): Promise<{ area: string; cases: ParityCase[] }[]> {
  const glob = new Bun.Glob("cases/*.ts");
  const files = [...glob.scanSync({ cwd: HERE })].sort();
  const areas = await Promise.all(
    files.map(async (f) => ({
      area: basename(f, ".ts"),
      cases: (await import(join(HERE, f))).cases as ParityCase[],
    }))
  );
  return areas.filter(
    (a) => areaFilter.length === 0 || areaFilter.includes(a.area)
  );
}

if (!skipBuild) {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    process.exit(1);
  }
}

const results: Result[] = [];
try {
  for (const { area, cases } of await loadCases()) {
    for (const c of cases) {
      const [verdict, detail] = await check(c);
      results.push({ area, c, verdict, detail });
      console.log(`${verdict.padEnd(11)} ${area}/${c.id}  ${detail}`);
    }
  }
} finally {
  for (const home of homes.values()) {
    rmSync(home, { recursive: true, force: true });
  }
}

const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
console.log(
  `\n${count("PASS")} pass, ${count("FAIL")} fail, ${count("UNSUPPORTED")} unsupported, ${results.length} total`
);
process.exit(count("FAIL") > 0 ? 1 : 0);
