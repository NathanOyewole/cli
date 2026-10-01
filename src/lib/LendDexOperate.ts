import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

import type { LendMarket } from "../clients/LendClient.ts";
import {
  INIT_TICK,
  LendTicks,
  MAX_I128,
  MIN_I128,
  MIN_TICK,
  type BranchAccount,
  type PositionAccount,
  type TickAccount,
  type TickIdLiquidationAccount,
} from "./LendTicks.ts";
import { LendTx } from "./LendTx.ts";
import { Rpc } from "./Rpc.ts";

// Hand-built port of @jup-ag/lend `getOperateDexIx` / `getOperatePerfectDexIx`
// (smart vault types 2-4): program IDs, PDA seeds and account layouts come from
// the SDK and its vaults/dex/oracle IDLs. Built with @solana/kit so the CLI
// does not bundle the SDK's anchor + web3.js dependencies.
const PROGRAMS: Record<LendMarket, { vaults: string; liquidity: string }> = {
  main: {
    vaults: "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi",
    liquidity: "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
  },
  ethena: {
    vaults: "jupo974WCqAUMD3RtpayTap1me7StQCWtEkBbDb6Ba3",
    liquidity: "jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS",
  },
};
const DEX_PROGRAM = address("jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const METADATA_PROGRAM = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const INSTRUCTIONS_SYSVAR = address(
  "Sysvar1nstructions1111111111111111111111111"
);
const RENT_SYSVAR = address("SysvarRent111111111111111111111111111111111");
const DEFAULT_PUBKEY = "11111111111111111111111111111111";
// Funded account the SDK simulates read-only instructions with.
const READONLY_SIGNER = address("HEyJLdMfZhhQ7FHCtjD5DWDFNFQhaeAVAsHeWqoY6dSD");
// The SDK passes the USDC reserve as a placeholder for a smart side's
// reserves account when reading vault exchange prices.
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Oracle source types whose hop expands into the DEX peg config's accounts.
const DEX_PEG_SOURCE_TYPES = new Set([9, 10]);
const OPERATE_DEX_REMAINING_ACCOUNTS_COUNT = 4;

const DISCRIMINATORS = {
  operateDex: [223, 122, 223, 181, 133, 132, 116, 33],
  operatePerfectDex: [88, 34, 180, 77, 152, 186, 166, 162],
  initPosition: [197, 20, 10, 1, 97, 160, 177, 91],
  initTick: [22, 13, 62, 141, 73, 89, 178, 29],
  initBranch: [162, 91, 57, 23, 228, 93, 111, 21],
  initTickIdLiquidation: [56, 110, 121, 169, 152, 241, 86, 183],
  getExchangePrices: [237, 128, 83, 152, 52, 21, 231, 86],
};

export type DexLegInput = {
  amount?: bigint;
  max?: boolean;
  token0?: bigint;
  token1?: bigint;
  shares?: bigint;
  minShares?: bigint;
  maxShares?: bigint;
  maxToken0?: bigint;
  maxToken1?: bigint;
  minToken0?: bigint;
  minToken1?: bigint;
};

export type DexOperateParams = {
  vaultId: number;
  positionId: number;
  signer: string;
  market: LendMarket;
  perfect: boolean;
  col: { action: "supply" | "withdraw"; input: DexLegInput } | null;
  debt: { action: "borrow" | "payback"; input: DexLegInput } | null;
};

export type DexOperateResult = {
  nftId: number;
  instructions: Instruction[];
  lookupTables: string[];
};

type DexAmounts = { a: bigint; b: bigint; c: bigint };
type Leg = { amounts: DexAmounts | null; scalar: bigint | null; sim: bigint };

type DexAccount = {
  address: Address;
  dexId: number;
  token0: Address;
  token1: Address;
  token0Decimals: number;
  token1Decimals: number;
  smartCol: boolean;
  smartDebt: boolean;
  centerPrice: Address | null;
};

type VaultConfig = {
  vaultType: number;
  borrowFee: number;
  oracle: Address;
  liquidityProgram: Address;
  oracleProgram: Address;
  supplyToken: Address;
  borrowToken: Address;
};

type VaultState = {
  branchLiquidated: number;
  topmostTick: number;
  currentBranchId: number;
  totalBranchId: number;
  nextPositionId: number;
};

export class LendDexOperate {
  public static async build(p: DexOperateParams): Promise<DexOperateResult> {
    const ids = PROGRAMS[p.market];
    const vaults = address(ids.vaults);
    const liquidityProgram = address(ids.liquidity);
    const signer = address(p.signer);
    const pda = (program: Address, seeds: (string | Uint8Array)[]) =>
      getProgramDerivedAddress({ programAddress: program, seeds }).then(
        (r) => r[0]
      );
    const vaultSeed = u16(p.vaultId);
    const tickPda = (tick: number) =>
      pda(vaults, ["tick", vaultSeed, u32(tick + 16383)]);
    const tickIdPda = (tick: number, totalIds: number) =>
      pda(vaults, [
        "tick_id_liquidation",
        vaultSeed,
        u32(tick + 16383),
        u32(Math.floor((totalIds + 2) / 3)),
      ]);
    const branchPda = (id: number) =>
      pda(vaults, ["branch", vaultSeed, u32(id)]);
    const positionPda = (id: number) =>
      pda(vaults, ["position", vaultSeed, u32(id)]);
    const positionMintPda = (id: number) =>
      pda(vaults, ["position_mint", vaultSeed, u32(id)]);
    const reservePda = (mint: Address) =>
      pda(liquidityProgram, ["reserve", addressBytes(mint)]);
    const rateModelPda = (mint: Address) =>
      pda(liquidityProgram, ["rate_model", addressBytes(mint)]);
    const supplyPositionPda = (mint: Address, protocol: Address) =>
      pda(liquidityProgram, [
        "user_supply_position",
        addressBytes(mint),
        addressBytes(protocol),
      ]);
    const borrowPositionPda = (mint: Address, protocol: Address) =>
      pda(liquidityProgram, [
        "user_borrow_position",
        addressBytes(mint),
        addressBytes(protocol),
      ]);
    const ata = async (mint: Address, owner: Address, program: Address) =>
      (await findAssociatedTokenPda({ mint, owner, tokenProgram: program }))[0];

    const [vaultConfigPda, vaultStatePda, vaultMetadataPda, liquidity] =
      await Promise.all([
        pda(vaults, ["vault_config", vaultSeed]),
        pda(vaults, ["vault_state", vaultSeed]),
        pda(vaults, ["vault_metadata", vaultSeed]),
        pda(liquidityProgram, ["liquidity"]),
      ]);
    const existingPositionPda =
      p.positionId === 0 ? null : await positionPda(p.positionId);
    const [configData, stateData, metadataData, positionData] = await fetchMany(
      [vaultConfigPda, vaultStatePda, vaultMetadataPda, existingPositionPda]
    );
    if (!configData || !stateData || !metadataData) {
      throw new Error(`Vault ${p.vaultId} not found on chain.`);
    }
    const config = decodeVaultConfig(configData);
    const state = decodeVaultState(stateData);
    const metadata = new Reader(metadataData).skip(2);
    const vaultLookupTable = metadata.pubkey();
    const supplyMintDecimals = metadata.u8();
    const borrowMintDecimals = metadata.u8();
    const isSmartCol = config.vaultType === 2 || config.vaultType === 4;
    const isSmartDebt = config.vaultType === 3 || config.vaultType === 4;
    if (!isSmartCol && !isSmartDebt) {
      throw new Error(`Vault ${p.vaultId} is not a smart (DEX) vault.`);
    }
    if (p.positionId !== 0 && !positionData) {
      throw new Error(
        `Position ${p.positionId} not found in vault ${p.vaultId}.`
      );
    }

    const supplyDexAddr = isSmartCol ? config.supplyToken : null;
    const borrowDexAddr = isSmartDebt ? config.borrowToken : null;
    const dexAddrs = [...new Set([supplyDexAddr, borrowDexAddr])].filter(
      (a): a is Address => a !== null
    );
    const [dexData, exchangePrices] = await Promise.all([
      fetchMany(dexAddrs),
      this.exchangePrices({
        vaults,
        liquidityProgram,
        vaultStatePda,
        vaultConfigPda,
        supplyReserve: isSmartCol ? address(USDC_MINT) : config.supplyToken,
        borrowReserve: isSmartDebt ? address(USDC_MINT) : config.borrowToken,
      }),
    ]);
    const dexes = new Map(
      dexAddrs.map((a, i) => {
        if (!dexData[i]) {
          throw new Error(`DEX ${a} not found on chain.`);
        }
        return [a, decodeDex(a, dexData[i]!)];
      })
    );
    const supplyDex = supplyDexAddr ? dexes.get(supplyDexAddr)! : null;
    const borrowDex = borrowDexAddr ? dexes.get(borrowDexAddr)! : null;
    const pairDex = (supplyDex ?? borrowDex)!;
    const { token0, token1 } = pairDex;

    const programs = await LendTx.tokenPrograms(
      [
        token0,
        token1,
        ...(isSmartCol ? [] : [config.supplyToken]),
        ...(isSmartDebt ? [] : [config.borrowToken]),
      ].map(String)
    );
    const programOf = (mint: Address) => programs.get(mint)!;
    const supplyMint = isSmartCol ? token0 : config.supplyToken;
    const borrowMint = isSmartDebt ? token1 : config.borrowToken;

    let col = p.col
      ? buildLeg(p.col.input, isSmartCol, p.perfect, p.col.action === "supply")
      : idleLeg(isSmartCol);
    let debt = p.debt
      ? buildLeg(
          p.debt.input,
          isSmartDebt,
          p.perfect,
          p.debt.action === "borrow"
        )
      : idleLeg(isSmartDebt);
    col = { ...col, sim: simDelta(col, isSmartCol, supplyMintDecimals) };
    debt = { ...debt, sim: simDelta(debt, isSmartDebt, borrowMintDecimals) };

    const position: PositionAccount = positionData
      ? decodePosition(positionData)
      : {
          nftId: state.nextPositionId,
          isSupplyOnlyPosition: 1,
          tick: INIT_TICK,
          tickId: 0,
          supplyAmount: 0n,
          dustDebtAmount: 0n,
        };
    const current = await this.currentPosition(
      position,
      state,
      borrowMintDecimals,
      tickPda,
      tickIdPda,
      branchPda
    );
    let existingTick = position.tick;
    let existingTickId = position.tickId;
    if (existingTick === INIT_TICK) {
      existingTick = current.tick;
      existingTickId = 0;
    }
    const finalTick = LendTicks.finalTick({
      current,
      newCol: col.sim,
      newDebt: debt.sim,
      supplyExchangePrice: exchangePrices.vaultSupply,
      borrowExchangePrice: exchangePrices.vaultBorrow,
      borrowFee: config.borrowFee,
    });

    const other = await this.otherInstructions({
      vaults,
      vaultId: p.vaultId,
      vaultConfigPda,
      signer,
      state,
      ticks: [existingTick, current.tick, finalTick],
      existingTickId,
      tickPda,
      tickIdPda,
      branchPda,
    });

    const [remaining, ataIxs, lookupTables] = await Promise.all([
      this.remainingAccounts({
        vaultId: p.vaultId,
        config,
        state,
        current,
        existingTick,
        finalTick,
        centerPriceOracles: [supplyDex, borrowDex]
          .map((d) => d?.centerPrice ?? null)
          .filter((a): a is Address => a !== null),
        branchPda,
        tickHasDebtPda: (index: number) =>
          pda(vaults, ["tick_has_debt", vaultSeed, new Uint8Array([index])]),
      }),
      this.ataSetup(
        signer,
        [
          isSmartCol ? null : config.supplyToken,
          isSmartDebt ? null : config.borrowToken,
          ...(supplyDex ? [supplyDex.token0, supplyDex.token1] : []),
          ...(borrowDex ? [borrowDex.token0, borrowDex.token1] : []),
        ],
        programOf
      ),
      this.dexLookupTables(dexes),
    ]);

    const nftId = position.nftId;
    const dexNested = async (dex: DexAccount | null) => {
      if (!dex) {
        return Array<null>(20).fill(null);
      }
      const p0 = programOf(dex.token0);
      const p1 = programOf(dex.token1);
      return [
        dex.address,
        await pda(DEX_PROGRAM, [
          "dex_position",
          addressBytes(dex.address),
          addressBytes(vaultConfigPda),
        ]),
        await ata(dex.token0, signer, p0),
        await ata(dex.token1, signer, p1),
        dex.token0,
        dex.token1,
        await reservePda(dex.token0),
        await reservePda(dex.token1),
        await rateModelPda(dex.token0),
        await rateModelPda(dex.token1),
        await ata(dex.token0, liquidity, p0),
        await ata(dex.token1, liquidity, p1),
        dex.smartCol ? await supplyPositionPda(dex.token0, dex.address) : null,
        dex.smartCol ? await supplyPositionPda(dex.token1, dex.address) : null,
        dex.smartDebt ? await borrowPositionPda(dex.token0, dex.address) : null,
        dex.smartDebt ? await borrowPositionPda(dex.token1, dex.address) : null,
        p0,
        p1,
        null,
        null,
      ];
    };
    const W = true;
    const R = false;
    const nestedRoles = [
      W,
      W,
      W,
      W,
      R,
      R,
      W,
      W,
      R,
      R,
      W,
      W,
      W,
      W,
      W,
      W,
      R,
      R,
      W,
      W,
    ];
    const [supplyNested, borrowNested] = await Promise.all([
      dexNested(supplyDex),
      dexNested(borrowDex),
    ]);
    const positionMint = await positionMintPda(nftId);
    const main: [Address | null, boolean][] = [
      [
        isSmartCol
          ? null
          : await ata(supplyMint, signer, programOf(supplyMint)),
        W,
      ],
      [
        isSmartDebt
          ? null
          : await ata(borrowMint, signer, programOf(borrowMint)),
        W,
      ],
      [null, R],
      [null, W],
      [null, W],
      [vaultConfigPda, W],
      [vaultStatePda, W],
      [isSmartCol ? null : supplyMint, R],
      [isSmartDebt ? null : borrowMint, R],
      [config.oracle, R],
      [await positionPda(nftId), W],
      [await ata(positionMint, signer, TOKEN_PROGRAM), R],
      [await tickPda(existingTick), W],
      [await tickPda(finalTick), W],
      [other.currentTickIdPda, R],
      [other.finalTickIdPda, W],
      [other.newBranchPda, W],
      [isSmartCol ? null : await reservePda(supplyMint), W],
      [isSmartDebt ? null : await reservePda(borrowMint), W],
      [
        await supplyPositionPda(
          isSmartCol ? borrowMint : supplyMint,
          vaultConfigPda
        ),
        W,
      ],
      [
        await borrowPositionPda(
          isSmartDebt ? supplyMint : borrowMint,
          vaultConfigPda
        ),
        W,
      ],
      [isSmartCol ? null : await rateModelPda(supplyMint), R],
      [isSmartDebt ? null : await rateModelPda(borrowMint), R],
      [
        isSmartCol
          ? null
          : await ata(supplyMint, liquidity, programOf(supplyMint)),
        W,
      ],
      [
        isSmartDebt
          ? null
          : await ata(borrowMint, liquidity, programOf(borrowMint)),
        W,
      ],
      [liquidity, R],
      [config.liquidityProgram, R],
      [config.oracleProgram, R],
      [isSmartCol ? null : programOf(supplyMint), R],
      [isSmartDebt ? null : programOf(borrowMint), R],
      [SYSTEM_PROGRAM, R],
      ...supplyNested.map((a, i): [Address | null, boolean] => [
        a,
        nestedRoles[i]!,
      ]),
      ...borrowNested.map((a, i): [Address | null, boolean] => [
        a,
        nestedRoles[i]!,
      ]),
      [DEX_PROGRAM, R],
    ];
    const accounts: AccountMeta[] = [
      { address: signer, role: AccountRole.WRITABLE_SIGNER },
      ...main.map(([a, writable]) =>
        a === null
          ? { address: vaults, role: AccountRole.READONLY }
          : {
              address: a,
              role: writable ? AccountRole.WRITABLE : AccountRole.READONLY,
            }
      ),
      ...remaining.accounts,
    ];
    const operateIx: Instruction = {
      programAddress: vaults,
      accounts,
      data: concat(
        p.perfect
          ? DISCRIMINATORS.operatePerfectDex
          : DISCRIMINATORS.operateDex,
        encodeLeg(col),
        encodeLeg(debt),
        [1, 1],
        u32(remaining.indices.length),
        remaining.indices
      ),
    };

    const initPositionIx =
      p.positionId === 0
        ? await this.initPositionIx({
            vaults,
            vaultId: p.vaultId,
            nftId,
            signer,
            vaultStatePda,
            position: await positionPda(nftId),
            positionMint,
            pda,
          })
        : null;

    return {
      nftId,
      instructions: [
        ...(initPositionIx ? [initPositionIx] : []),
        ...ataIxs,
        ...other.instructions,
        operateIx,
      ],
      lookupTables: [String(vaultLookupTable), ...lookupTables].filter(
        (t) => t !== DEFAULT_PUBKEY
      ),
    };
  }

  private static async exchangePrices(p: {
    vaults: Address;
    liquidityProgram: Address;
    vaultStatePda: Address;
    vaultConfigPda: Address;
    supplyReserve: Address;
    borrowReserve: Address;
  }): Promise<{ vaultSupply: bigint; vaultBorrow: bigint }> {
    const reserve = (mint: Address) =>
      getProgramDerivedAddress({
        programAddress: p.liquidityProgram,
        seeds: ["reserve", addressBytes(mint)],
      }).then((r) => r[0]);
    const ix: Instruction = {
      programAddress: p.vaults,
      accounts: [
        { address: p.vaultStatePda, role: AccountRole.READONLY },
        { address: p.vaultConfigPda, role: AccountRole.READONLY },
        { address: await reserve(p.supplyReserve), role: AccountRole.READONLY },
        { address: await reserve(p.borrowReserve), role: AccountRole.READONLY },
      ],
      data: Uint8Array.from(DISCRIMINATORS.getExchangePrices),
    };
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(READONLY_SIGNER, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: DEFAULT_PUBKEY as Blockhash,
            lastValidBlockHeight: 0n,
          },
          m
        ),
      (m) => appendTransactionMessageInstruction(ix, m)
    );
    const { value } = await withRetry(() =>
      createSolanaRpc(Rpc.url)
        .simulateTransaction(
          getBase64EncodedWireTransaction(compileTransaction(message)),
          { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }
        )
        .send()
    );
    const data = value.returnData?.data[0];
    if (!data) {
      throw new Error(
        `Could not read vault exchange prices: ${JSON.stringify(value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`
      );
    }
    const r = new Reader(fromBase64(data), 0);
    r.skip(32);
    return { vaultSupply: r.u128(), vaultBorrow: r.u128() };
  }

  private static async currentPosition(
    position: PositionAccount,
    state: VaultState,
    borrowMintDecimals: number,
    tickPda: (tick: number) => Promise<Address>,
    tickIdPda: (tick: number, totalIds: number) => Promise<Address>,
    branchPda: (id: number) => Promise<Address>
  ) {
    const tick = position.tick === INIT_TICK ? MIN_TICK : position.tick;
    if (position.isSupplyOnlyPosition || tick <= MIN_TICK) {
      return LendTicks.currentPosition({
        position,
        tickData: null,
        tickIdData: null,
        branches: [],
        borrowMintDecimals,
      });
    }
    const [tickRaw] = await fetchMany([await tickPda(tick)]);
    if (!tickRaw) {
      throw new Error(`Tick ${tick} account not found.`);
    }
    const tickData = decodeTick(tickRaw);
    let tickIdData: TickIdLiquidationAccount | null = null;
    let branches: BranchAccount[] = [];
    if (tickData.isLiquidated || tickData.totalIds > position.tickId) {
      const branchIds = Array.from(
        { length: state.totalBranchId + 1 },
        (_, i) => i
      );
      const raw = await fetchMany([
        await tickIdPda(tick, position.tickId),
        ...(await Promise.all(branchIds.map(branchPda))),
      ]);
      tickIdData = raw[0] ? decodeTickIdLiquidation(raw[0]) : null;
      branches = raw
        .slice(1)
        .filter((b): b is Uint8Array => b !== null)
        .map(decodeBranch);
    }
    return LendTicks.currentPosition({
      position,
      tickData,
      tickIdData,
      branches,
      borrowMintDecimals,
    });
  }

  // init_tick / init_branch / init_tick_id_liquidation for any account the
  // operate touches that does not exist yet (getOtherInstructionsOperate).
  private static async otherInstructions(p: {
    vaults: Address;
    vaultId: number;
    vaultConfigPda: Address;
    signer: Address;
    state: VaultState;
    ticks: [number, number, number];
    existingTickId: number;
    tickPda: (tick: number) => Promise<Address>;
    tickIdPda: (tick: number, totalIds: number) => Promise<Address>;
    branchPda: (id: number) => Promise<Address>;
  }) {
    const instructions: Instruction[] = [];
    const [currentTick, , finalTick] = p.ticks;
    const tickAddrs = await Promise.all(p.ticks.map(p.tickPda));
    const tickRaw = await fetchMany(tickAddrs);
    const ticks = tickRaw.map((t) => (t ? decodeTick(t) : null));
    ticks.forEach((t, i) => {
      if (!t) {
        instructions.push(
          this.ix(
            p.vaults,
            DISCRIMINATORS.initTick,
            [u16(p.vaultId), i32(p.ticks[i]!)],
            [
              [p.signer, AccountRole.WRITABLE_SIGNER],
              [p.vaultConfigPda, AccountRole.READONLY],
              [tickAddrs[i]!, AccountRole.WRITABLE],
              [SYSTEM_PROGRAM, AccountRole.READONLY],
            ]
          )
        );
      }
    });
    const finalTickData = ticks[2];

    let newBranchId = p.state.currentBranchId;
    if (p.state.branchLiquidated) {
      newBranchId = p.state.totalBranchId + 1;
      const branch = await p.branchPda(newBranchId);
      const [existing] = await fetchMany([branch]);
      if (!existing) {
        instructions.push(
          this.ix(
            p.vaults,
            DISCRIMINATORS.initBranch,
            [u16(p.vaultId), u32(newBranchId)],
            [
              [p.signer, AccountRole.WRITABLE_SIGNER],
              [p.vaultConfigPda, AccountRole.READONLY],
              [branch, AccountRole.WRITABLE],
              [SYSTEM_PROGRAM, AccountRole.READONLY],
            ]
          )
        );
      }
    }

    const initTickId = async (tick: number, totalIds: number) => {
      const tickAddr = await p.tickPda(tick);
      const [raw] = await fetchMany([tickAddr]);
      const seedIds = raw ? decodeTick(raw).totalIds : 0;
      return this.ix(
        p.vaults,
        DISCRIMINATORS.initTickIdLiquidation,
        [u16(p.vaultId), i32(tick), u32(totalIds)],
        [
          [p.signer, AccountRole.WRITABLE_SIGNER],
          [tickAddr, AccountRole.READONLY],
          [await p.tickIdPda(tick, seedIds), AccountRole.WRITABLE],
          [SYSTEM_PROGRAM, AccountRole.READONLY],
        ]
      );
    };
    const toRead = [{ tick: currentTick, totalIds: p.existingTickId }];
    if (finalTick !== currentTick) {
      if (finalTickData) {
        toRead.push({ tick: finalTick, totalIds: finalTickData.totalIds });
      } else {
        instructions.push(await initTickId(finalTick, 0));
      }
    }
    const tickIdRaw = await fetchMany(
      await Promise.all(toRead.map((t) => p.tickIdPda(t.tick, t.totalIds)))
    );
    for (const [i, raw] of tickIdRaw.entries()) {
      if (!raw) {
        instructions.push(
          await initTickId(toRead[i]!.tick, toRead[i]!.totalIds)
        );
      }
    }

    return {
      instructions,
      newBranchPda: await p.branchPda(newBranchId),
      currentTickIdPda: await p.tickIdPda(currentTick, p.existingTickId),
      finalTickIdPda: await p.tickIdPda(
        finalTick,
        finalTickData?.totalIds ?? 0
      ),
    };
  }

  private static async remainingAccounts(p: {
    vaultId: number;
    config: VaultConfig;
    state: VaultState;
    current: {
      userLiquidationStatus: boolean;
      postLiquidationBranchId: number;
    };
    existingTick: number;
    finalTick: number;
    centerPriceOracles: Address[];
    branchPda: (id: number) => Promise<Address>;
    tickHasDebtPda: (index: number) => Promise<Address>;
  }): Promise<{ accounts: AccountMeta[]; indices: number[] }> {
    const [sources, branches, tickHasDebt, centerPrice] = await Promise.all([
      this.oracleSources(p.config.oracle),
      this.relevantBranches(p),
      this.relevantTickHasDebtArrays(p),
      this.centerPriceAccounts(p.centerPriceOracles),
    ]);
    const branchAddrs = await Promise.all(branches.map(p.branchPda));
    const readonly = (a: Address) => ({
      address: a,
      role: AccountRole.READONLY,
    });
    const writable = (a: Address) => ({
      address: a,
      role: AccountRole.WRITABLE,
    });
    const indices = [
      sources.length,
      branchAddrs.length,
      tickHasDebt.length,
      centerPrice.length,
    ];
    if (indices.length !== OPERATE_DEX_REMAINING_ACCOUNTS_COUNT) {
      throw new Error("Unexpected operate_dex remaining accounts layout.");
    }
    return {
      accounts: [
        ...sources.map(readonly),
        ...branchAddrs.map(writable),
        ...tickHasDebt.map(writable),
        ...centerPrice.map(readonly),
      ],
      indices,
    };
  }

  private static async oracleSources(oracle: Address): Promise<Address[]> {
    const [raw] = await fetchMany([oracle]);
    if (!raw) {
      throw new Error(`Oracle ${oracle} not found on chain.`);
    }
    const sources = decodeOracleSources(raw);
    const pegs = sources.filter((s) => DEX_PEG_SOURCE_TYPES.has(s.sourceType));
    const pegData = await fetchMany(pegs.map((s) => s.source));
    const accounts: Address[] = [];
    for (const s of sources) {
      const peg = pegs.indexOf(s);
      if (peg === -1) {
        accounts.push(s.source);
        continue;
      }
      const cfg = new Reader(pegData[peg]!).skip(2);
      const [dex, pos0, pos1, res0, res1] = [1, 2, 3, 4, 5].map(() =>
        cfg.pubkey()
      );
      cfg.skip(1);
      const conversion = cfg.pubkey();
      accounts.push(s.source, dex!, pos0!, pos1!, res0!, res1!);
      if (conversion !== DEFAULT_PUBKEY) {
        accounts.push(conversion);
      }
    }
    return accounts;
  }

  private static async centerPriceAccounts(oracles: Address[]) {
    const unique = [...new Set(oracles)];
    const raw = await fetchMany(unique);
    return unique.flatMap((o, i) => [
      o,
      ...decodeOracleSources(raw[i]!).map((s) => s.source),
    ]);
  }

  private static async relevantBranches(p: {
    state: VaultState;
    current: {
      userLiquidationStatus: boolean;
      postLiquidationBranchId: number;
    };
    branchPda: (id: number) => Promise<Address>;
  }): Promise<number[]> {
    const added = new Set<number>();
    const fetchBranch = async (id: number) => {
      const [raw] = await fetchMany([await p.branchPda(id)]);
      return raw ? decodeBranch(raw) : null;
    };
    const currentId =
      p.current.postLiquidationBranchId > 0
        ? p.current.postLiquidationBranchId
        : p.state.currentBranchId;
    let connected = 0;
    if (currentId > 0) {
      const branch = await fetchBranch(currentId);
      if (branch) {
        added.add(branch.branchId);
        connected = branch.connectedBranchId;
      }
    }
    if (p.current.userLiquidationStatus) {
      while (connected > 0) {
        const branch = await fetchBranch(connected);
        if (!branch) {
          break;
        }
        added.add(branch.branchId);
        connected = branch.connectedBranchId;
      }
      added.add(0);
    }
    return [...added];
  }

  private static async relevantTickHasDebtArrays(p: {
    state: VaultState;
    existingTick: number;
    finalTick: number;
    tickHasDebtPda: (index: number) => Promise<Address>;
  }): Promise<Address[]> {
    const topTick = p.state.topmostTick === 0 ? INIT_TICK : p.state.topmostTick;
    // Not deduplicated: the SDK collects these in a Set of PublicKey objects,
    // which keeps repeats, and the program accepts them.
    const arrays: Address[] = [];
    const finalIndex = LendTicks.tickIndices(p.finalTick).arrayIndex;
    if (p.existingTick === topTick) {
      const next = await LendTicks.nextTickWithDebt(topTick, async (index) => {
        const [raw] = await fetchMany([await p.tickHasDebtPda(index)]);
        if (!raw) {
          return null;
        }
        const r = new Reader(raw).skip(3);
        return Array.from({ length: 8 }, () => r.bytes(32));
      });
      const start = LendTicks.tickIndices(next).arrayIndex;
      let end = LendTicks.tickIndices(topTick).arrayIndex;
      arrays.push(await p.tickHasDebtPda(finalIndex));
      if (end < 15) {
        end++;
      }
      for (let i = start; i <= end; i++) {
        arrays.push(await p.tickHasDebtPda(i));
      }
    } else {
      arrays.push(await p.tickHasDebtPda(finalIndex));
      arrays.push(
        await p.tickHasDebtPda(LendTicks.tickIndices(p.existingTick).arrayIndex)
      );
    }
    return arrays;
  }

  private static async ataSetup(
    owner: Address,
    mints: (Address | null)[],
    programOf: (mint: Address) => Address
  ): Promise<Instruction[]> {
    const unique = [...new Set(mints.filter((m): m is Address => m !== null))];
    const atas = await Promise.all(
      unique.map(async (mint) => ({
        mint,
        ata: (
          await findAssociatedTokenPda({
            owner,
            mint,
            tokenProgram: programOf(mint),
          })
        )[0],
      }))
    );
    const existing = await fetchMany(atas.map((a) => a.ata));
    return Promise.all(
      atas
        .filter((_, i) => !existing[i])
        .map(({ mint }) => LendTx.createAta(owner, mint, programOf(mint)))
    );
  }

  private static async dexLookupTables(
    dexes: Map<Address, DexAccount>
  ): Promise<string[]> {
    const dexIds = [...new Set([...dexes.values()].map((d) => d.dexId))];
    const metadata = await Promise.all(
      dexIds.map((id) =>
        getProgramDerivedAddress({
          programAddress: DEX_PROGRAM,
          seeds: ["dex_metadata", u16(id)],
        }).then((r) => r[0])
      )
    );
    const raw = await fetchMany(metadata);
    return raw
      .filter((r): r is Uint8Array => r !== null)
      .map((r) => String(new Reader(r).skip(2).pubkey()));
  }

  private static async initPositionIx(p: {
    vaults: Address;
    vaultId: number;
    nftId: number;
    signer: Address;
    vaultStatePda: Address;
    position: Address;
    positionMint: Address;
    pda: (program: Address, seeds: (string | Uint8Array)[]) => Promise<Address>;
  }): Promise<Instruction> {
    const [metadata, admin, tokenAccount] = await Promise.all([
      p.pda(METADATA_PROGRAM, [
        "metadata",
        addressBytes(METADATA_PROGRAM),
        addressBytes(p.positionMint),
      ]),
      p.pda(p.vaults, ["vault_admin"]),
      findAssociatedTokenPda({
        owner: p.signer,
        mint: p.positionMint,
        tokenProgram: TOKEN_PROGRAM,
      }).then((r) => r[0]),
    ]);
    return this.ix(
      p.vaults,
      DISCRIMINATORS.initPosition,
      [u16(p.vaultId), u32(p.nftId)],
      [
        [p.signer, AccountRole.WRITABLE_SIGNER],
        [admin, AccountRole.READONLY],
        [p.vaultStatePda, AccountRole.WRITABLE],
        [p.position, AccountRole.WRITABLE],
        [p.positionMint, AccountRole.WRITABLE],
        [tokenAccount, AccountRole.WRITABLE],
        [metadata, AccountRole.WRITABLE],
        [TOKEN_PROGRAM, AccountRole.READONLY],
        [ASSOCIATED_TOKEN_PROGRAM, AccountRole.READONLY],
        [SYSTEM_PROGRAM, AccountRole.READONLY],
        [INSTRUCTIONS_SYSVAR, AccountRole.READONLY],
        [METADATA_PROGRAM, AccountRole.READONLY],
        [RENT_SYSVAR, AccountRole.READONLY],
      ]
    );
  }

  private static ix(
    program: Address,
    discriminator: number[],
    args: Uint8Array[],
    accounts: [Address, AccountRole][]
  ): Instruction {
    return {
      programAddress: program,
      accounts: accounts.map(([a, role]) => ({ address: a, role })),
      data: concat(discriminator, ...args),
    };
  }
}

// --- leg structs (buildLegStruct / idleLeg / deriveLegDelta in the SDK) ---

function buildLeg(
  input: DexLegInput,
  smart: boolean,
  perfect: boolean,
  positive: boolean
): Leg {
  const ZERO = 0n;
  if (!smart) {
    const scalar =
      !positive && input.max
        ? MIN_I128
        : positive
          ? (input.amount ?? ZERO)
          : -(input.amount ?? ZERO);
    return { amounts: null, scalar, sim: 0n };
  }
  if (perfect) {
    const amounts = positive
      ? {
          a: input.shares ?? ZERO,
          b: input.maxToken0 ?? MAX_I128,
          c: input.maxToken1 ?? MAX_I128,
        }
      : {
          a: input.max ? MIN_I128 : -(input.shares ?? ZERO),
          b: -(input.minToken0 ?? ZERO),
          c: -(input.minToken1 ?? ZERO),
        };
    validatePerfect(amounts);
    return { amounts, scalar: null, sim: amounts.a };
  }
  if (input.shares === undefined || input.shares === ZERO) {
    throw new Error(
      "Smart-vault operate: missing the share estimate for this leg."
    );
  }
  const amounts = positive
    ? {
        a: input.token0 ?? ZERO,
        b: input.token1 ?? ZERO,
        c: input.minShares ?? input.maxShares ?? 1n,
      }
    : {
        a: -(input.token0 ?? ZERO),
        b: -(input.token1 ?? ZERO),
        c: -(input.maxShares ?? input.minShares ?? ZERO),
      };
  validateImperfect(amounts);
  return {
    amounts,
    scalar: null,
    sim: positive ? input.shares : -input.shares,
  };
}

function idleLeg(smart: boolean): Leg {
  return smart
    ? { amounts: { a: 0n, b: 0n, c: 0n }, scalar: null, sim: 0n }
    : { amounts: null, scalar: 0n, sim: 0n };
}

// The signed delta the tick simulation uses: the smart leg's share delta, or
// a normal leg's token delta scaled to 9 decimals.
function simDelta(leg: Leg, smart: boolean, mintDecimals: number): bigint {
  if (leg.scalar === null) {
    return leg.sim;
  }
  if (smart || leg.scalar <= MIN_I128 || mintDecimals === 9) {
    return leg.scalar;
  }
  return leg.scalar * 10n ** BigInt(9 - mintDecimals);
}

function validatePerfect({ a: shares, b: t0, c: t1 }: DexAmounts): void {
  const fail = (msg: string) => {
    throw new Error(`Smart-vault operate: ${msg}`);
  };
  if (shares > 0n && (t0 <= 0n || t1 <= 0n)) {
    fail("perfect deposit/borrow needs positive token bounds.");
  }
  if (shares === 0n && (t0 !== 0n || t1 !== 0n)) {
    fail("an idle perfect leg must have zero token bounds.");
  }
  if (shares < 0n && (t0 > 0n || t1 > 0n || (t0 === 0n && t1 === 0n))) {
    fail("perfect withdraw/payback needs at least one negative token bound.");
  }
}

function validateImperfect({ a: t0, b: t1, c: shares }: DexAmounts): void {
  const fail = (msg: string) => {
    throw new Error(`Smart-vault operate: ${msg}`);
  };
  if (t0 === MIN_I128 || t1 === MIN_I128 || shares === MIN_I128) {
    fail("a full exit needs the perfect builder.");
  }
  if (shares > 0n && (t0 < 0n || t1 < 0n || (t0 === 0n && t1 === 0n))) {
    fail("deposit/borrow amounts must be positive.");
  }
  if (shares < 0n && (t0 > 0n || t1 > 0n || (t0 === 0n && t1 === 0n))) {
    fail("withdraw/payback amounts must be positive.");
  }
  if (shares === 0n && (t0 !== 0n || t1 !== 0n)) {
    fail("an idle leg must have zero amounts.");
  }
}

function encodeLeg(leg: Leg): Uint8Array {
  const parts: (number[] | Uint8Array)[] = [[1]];
  if (leg.amounts) {
    parts.push(
      [1],
      i128(leg.amounts.a),
      i128(leg.amounts.b),
      i128(leg.amounts.c)
    );
  } else {
    parts.push([0]);
  }
  if (leg.scalar !== null) {
    parts.push([1], i128(leg.scalar));
  } else {
    parts.push([0]);
  }
  return concat(...parts);
}

// --- account decoding (packed C layouts after the 8-byte discriminator) ---

class Reader {
  private offset: number;
  private readonly view: DataView;

  constructor(
    private readonly data: Uint8Array,
    start = 8
  ) {
    this.offset = start;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  skip(n: number): this {
    this.offset += n;
    return this;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u64(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  u128(): bigint {
    const lo = this.u64();
    return (this.u64() << 64n) | lo;
  }

  bytes(n: number): Uint8Array {
    const v = this.data.slice(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  pubkey(): Address {
    return getAddressDecoder().decode(this.bytes(32));
  }
}

function decodeVaultConfig(data: Uint8Array): VaultConfig {
  const r = new Reader(data).skip(16);
  const borrowFee = r.u8();
  const vaultType = r.u8();
  const oracle = r.pubkey();
  r.skip(32);
  return {
    vaultType,
    borrowFee,
    oracle,
    liquidityProgram: r.pubkey(),
    oracleProgram: r.pubkey(),
    supplyToken: r.pubkey(),
    borrowToken: r.pubkey(),
  };
}

function decodeVaultState(data: Uint8Array): VaultState {
  const r = new Reader(data).skip(2);
  const branchLiquidated = r.u8();
  const topmostTick = r.i32();
  const currentBranchId = r.u32();
  const totalBranchId = r.u32();
  r.skip(8 + 8 + 4 + 16 + 16 + 8 + 8 * 4);
  return {
    branchLiquidated,
    topmostTick,
    currentBranchId,
    totalBranchId,
    nextPositionId: r.u32(),
  };
}

function decodePosition(data: Uint8Array): PositionAccount {
  const r = new Reader(data).skip(2);
  const nftId = r.u32();
  r.skip(32);
  return {
    nftId,
    isSupplyOnlyPosition: r.u8(),
    tick: r.i32(),
    tickId: r.u32(),
    supplyAmount: r.u64(),
    dustDebtAmount: r.u64(),
  };
}

function decodeTick(data: Uint8Array): TickAccount {
  const r = new Reader(data).skip(6);
  const isLiquidated = r.u8();
  const totalIds = r.u32();
  r.skip(8);
  return {
    isLiquidated,
    totalIds,
    isFullyLiquidated: r.u8(),
    liquidationBranchId: r.u32(),
    debtFactor: r.u64(),
  };
}

function decodeTickIdLiquidation(data: Uint8Array): TickIdLiquidationAccount {
  const r = new Reader(data).skip(10);
  const sets = [0, 1, 2].map(() => ({
    isFullyLiquidated: r.u8(),
    branchId: r.u32(),
    debtFactor: r.u64(),
  }));
  return {
    isFullyLiquidated: sets.map((s) => s.isFullyLiquidated) as [
      number,
      number,
      number,
    ],
    liquidationBranchId: sets.map((s) => s.branchId) as [
      number,
      number,
      number,
    ],
    debtFactor: sets.map((s) => s.debtFactor) as [bigint, bigint, bigint],
  };
}

function decodeBranch(data: Uint8Array): BranchAccount {
  const r = new Reader(data).skip(2);
  const branchId = r.u32();
  const status = r.u8();
  const minimaTick = r.i32();
  const minimaTickPartials = r.u32();
  r.skip(8);
  const debtFactor = r.u64();
  return {
    branchId,
    status,
    minimaTick,
    minimaTickPartials,
    debtFactor,
    connectedBranchId: r.u32(),
  };
}

function decodeDex(addr: Address, data: Uint8Array): DexAccount {
  const r = new Reader(data);
  const dexId = r.u16();
  r.skip(1);
  const token0 = r.pubkey();
  const token1 = r.pubkey();
  const token0Decimals = r.u8();
  const token1Decimals = r.u8();
  r.skip(16 * 3 + 8 + 8);
  const smartCol = r.u8() === 1;
  const smartDebt = r.u8() === 1;
  r.skip(4 + 1 + 1 + 4 + 4 + 1 + 2 + 2 + 4);
  const centerPrice = r.pubkey();
  return {
    address: addr,
    dexId,
    token0,
    token1,
    token0Decimals,
    token1Decimals,
    smartCol,
    smartDebt,
    centerPrice: centerPrice === DEFAULT_PUBKEY ? null : centerPrice,
  };
}

function decodeOracleSources(
  data: Uint8Array
): { source: Address; sourceType: number }[] {
  const r = new Reader(data).skip(2);
  const count = r.u32();
  return Array.from({ length: count }, () => {
    const source = r.pubkey();
    r.skip(1 + 16 + 16);
    return { source, sourceType: r.u8() };
  });
}

// --- encoding helpers ---

async function fetchMany(
  addresses: (Address | null)[]
): Promise<(Uint8Array | null)[]> {
  const wanted = addresses.filter((a): a is Address => a !== null);
  const rpc = createSolanaRpc(Rpc.url);
  const found = new Map<Address, Uint8Array | null>();
  for (let i = 0; i < wanted.length; i += 100) {
    const chunk = wanted.slice(i, i + 100);
    const { value } = await withRetry(() =>
      rpc.getMultipleAccounts(chunk, { encoding: "base64" }).send()
    );
    chunk.forEach((a, j) => {
      const account = value[j];
      found.set(a, account ? fromBase64(account.data[0]) : null);
    });
  }
  return addresses.map((a) => (a === null ? null : (found.get(a) ?? null)));
}

// The build makes a dozen small reads; public RPCs rate-limit bursts.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4 || !String(err).includes("429")) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(base64));
}

function addressBytes(a: Address): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(a));
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function i32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

function i128(n: bigint): Uint8Array {
  const b = new Uint8Array(16);
  const view = new DataView(b.buffer);
  const v = BigInt.asUintN(128, n);
  view.setBigUint64(0, v & (2n ** 64n - 1n), true);
  view.setBigUint64(8, v >> 64n, true);
  return b;
}

function concat(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
