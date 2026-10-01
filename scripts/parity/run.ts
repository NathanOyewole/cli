import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FEATURES } from "./features.ts";
import { type ParityCase } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");
const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DEFAULT_WALLET =
  process.env.PARITY_WALLET ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

type Verdict = "PASS" | "UNFUNDED" | "FAIL" | "UNTESTED" | "UNSUPPORTED";
type Result = { area: string; c: ParityCase; verdict: Verdict; detail: string };

const areaFilter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const skipBuild = process.argv.includes("--no-build");
const coverageOnly = process.argv.includes("--coverage");

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

// Auth-gated commands (trigger-api) need a real message signature, so these
// cases run with an unfunded generated keypair. It is cached across runs because
// signing in registers a server-side vault for the wallet.
const GENERATED_KEY_FILE = join(
  homedir(),
  ".cache",
  "jup-parity",
  "generated.json"
);

function makeGeneratedKeyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "jup-parity-gen-"));
  const args = existsSync(GENERATED_KEY_FILE)
    ? ["keys", "add", "generated", "--file", GENERATED_KEY_FILE]
    : ["keys", "add", "generated"];
  const { status, stdout, stderr } = runCli(home, args);
  if (status !== 0) {
    throw new Error(`keys add failed: ${stdout}${stderr}`);
  }
  if (!existsSync(GENERATED_KEY_FILE)) {
    mkdirSync(dirname(GENERATED_KEY_FILE), { recursive: true });
    copyFileSync(
      join(home, ".config", "jup", "keys", "generated.json"),
      GENERATED_KEY_FILE
    );
  }
  writeFileSync(
    join(home, ".config", "jup", "settings.json"),
    JSON.stringify({ activeKey: "generated", output: "json" })
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
    // Instant (keeper co-signed) perps txs stamp a request time a few seconds
    // ahead of the cluster clock; the keeper lands them once the clock catches up.
    if (logs?.some((l) => l.includes("InvalidRequestTime")) && attempt < 3) {
      await Bun.sleep(4000);
      continue;
    }
    const tail = (logs ?? []).filter((l) => /error|failed/i.test(l)).at(-1);
    return `${JSON.stringify(err)} ${tail ?? ""}`.trim();
  }
  return "rpc: rate limited";
}

const GENERATED = "generated";
const homes = new Map<string, string>();
function homeFor(wallet: string): string {
  if (!homes.has(wallet)) {
    homes.set(
      wallet,
      wallet === GENERATED ? makeGeneratedKeyHome() : makeHome(wallet)
    );
  }
  return homes.get(wallet)!;
}

async function check(c: ParityCase): Promise<[Verdict, string]> {
  if (c.kind === "unsupported") {
    return ["UNSUPPORTED", c.reason];
  }
  if (c.kind === "untested") {
    return ["UNTESTED", c.reason];
  }
  let vars: Record<string, string> = {};
  try {
    vars = c.resolve ? await c.resolve() : {};
  } catch (err) {
    return ["FAIL", `resolve: ${err instanceof Error ? err.message : err}`];
  }
  const wallet = vars.WALLET ?? c.wallet ?? DEFAULT_WALLET;
  const home = homeFor(c.key === "generated" ? GENERATED : wallet);
  const substitutions = Object.entries({ ...vars, WALLET: wallet });
  const args = c.args.map((a) =>
    substitutions.reduce((s, [k, v]) => s.replaceAll(`$${k}`, v), a)
  );
  const flags = c.kind === "tx" ? ["-f", "json", "--dry-run"] : ["-f", "json"];
  let run = runCli(home, [...flags, ...args]);
  for (
    let attempt = 1;
    attempt < 5 && /rate limit|too many requests/i.test(run.stdout);
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
  if (failures.length === 0) {
    return ["PASS", `${txs.length} tx simulated`];
  }
  if (c.expectSimError && failures.every((f) => c.expectSimError!.test(f))) {
    return [
      "UNFUNDED",
      `${txs.length} tx built; simulation failed only for lack of funds: ${failures[0]!.slice(0, 200)}`,
    ];
  }
  return ["FAIL", `simulation: ${failures.join(" | ").slice(0, 400)}`];
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
  return areas;
}

function coverageGaps(areas: { cases: ParityCase[] }[]) {
  const known = new Set(Object.values(FEATURES).flat());
  const covered = new Set(areas.flatMap((a) => a.cases.map((c) => c.feature)));
  return {
    uncovered: [...known].filter((f) => !covered.has(f)),
    unknown: [...covered].filter((f) => !known.has(f)),
  };
}

const allAreas = await loadCases();
const { uncovered, unknown } = coverageGaps(allAreas);
for (const f of uncovered) {
  console.log(`UNCOVERED   ${f}`);
}
for (const f of unknown) {
  console.log(`UNKNOWN     ${f} (not a feature ID in features.ts)`);
}
const coverageOk = uncovered.length === 0 && unknown.length === 0;
if (coverageOnly) {
  process.exit(coverageOk ? 0 : 1);
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
  const selected = allAreas.filter(
    (a) => areaFilter.length === 0 || areaFilter.includes(a.area)
  );
  for (const { area, cases } of selected) {
    for (const c of cases) {
      let [verdict, detail] = await check(c);
      // Live markets move between build and simulation; a real defect fails twice.
      if (verdict === "FAIL") {
        await Bun.sleep(5000);
        const [retried, retryDetail] = await check(c);
        if (retried !== "FAIL") {
          [verdict, detail] = [
            retried,
            `${retryDetail} (passed on retry: ${detail.slice(0, 120)})`,
          ];
        }
      }
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
  `
${count("PASS")} pass, ${count("UNFUNDED")} unfunded, ${count("FAIL")} fail, ${count("UNTESTED")} untested, ${count("UNSUPPORTED")} unsupported, ${results.length} total; ${uncovered.length} feature IDs uncovered`
);
process.exit(count("FAIL") > 0 || !coverageOk ? 1 : 0);
