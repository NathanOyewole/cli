import type { LendMarket } from "../clients/LendClient.ts";

// Static content of jup.ag/lend/transparency (TransparencyPage/data.ts in the
// web app). The page's live multisig lookups used the Squads v4 API, which now
// returns 410 Gone.
const AUDITS = [
  {
    title: "Certora Formal Verification - Jupiter Lend",
    date: "January 7 - March 31, 2026",
    url: "https://static-r2.jup.ag/lend/audits/lend-certora-fv-2.pdf",
  },
  {
    title: "Certora Formal Verification - Jupiter Lend",
    date: "September 15 - December 1, 2025",
    url: "https://static-r2.jup.ag/lend/audits/centora_audit.pdf",
  },
  {
    title: "Code4rena - Jupiter Lend Report",
    date: "February 12 - March 13, 2026",
    url: "https://static-r2.jup.ag/lend/audits/lend-code4rena.pdf",
  },
  {
    title: "OtterSec - Lending Report",
    date: "Nov 12 - Nov 20, 2025",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-ottersec-2.pdf",
  },
  {
    title: "OtterSec - Liquidity and Vaults Report",
    date: "August 20 - November 1, 2025",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-ottersec.pdf",
  },
  {
    title: "Offside Labs - Oracle and Flashloan Report",
    date: "October 13 - October 19, 2025",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-oracle-and-flashloan-offside.pdf",
  },
  {
    title: "Mixbytes - Vault Report",
    date: "July 28 - October 14, 2025",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-vault-mixbytes.pdf",
  },
  {
    title: "Offside Labs - Vault Report",
    date: "July 23 - August 4, 2025",
    url: "https://github.com/jup-ag/docs/tree/main/static/files/audits/lend-vault-offside.pdf",
  },
  {
    title: "Zenith Report",
    date: "June 24 - July 31, 2025",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-zenith.pdf",
  },
  {
    title: "Offside Labs - Liquidity Report",
    date: "July 10 - July 18, 2025",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-liquidity-offside.pdf",
  },
  {
    title: "OtterSec - Vault Integration Report (AMM)",
    date: "May 8 - June 17, 2026",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-amm-integration-ottersec.pdf",
  },
  {
    title: "Neodyme Report (AMM)",
    date: "May - June 2026",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-amm-neodyme.pdf",
  },
  {
    title: "OtterSec Report (AMM)",
    date: "May 19 - June 4, 2026",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-amm-ottersec.pdf",
  },
  {
    title: "Zenith Report (AMM)",
    date: "April 14 - May 11, 2026",
    url: "https://github.com/jup-ag/docs/blob/main/static/files/audits/lend-amm-zenith.pdf",
  },
];

const RISK_REPORTS = [
  {
    title: "Reinsurance Yield Token (Senior Tranche): reUSD",
    date: "August 1, 2026",
    url: "https://static-r2.jup.ag/lend/audits/reusd-risk-report.pdf",
  },
  {
    title: "Jupiter Liquidity Provider Token (JLP)",
    date: "April 30, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/jlp-risk-report.pdf",
  },
  {
    title: "Sanctum-Based LSTs: INF, JUPSOL, dfdvSOL, fwdSOL",
    date: "April 30, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/sanctum-risk-report.pdf",
  },
  {
    title: "Yield-Bearing Bitcoin: LBTC (Lombard Staked BTC)",
    date: "April 30, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/lbtc-risk-report.pdf",
  },
  {
    title: "Wrapped Bitcoin: cbBTC, WBTC, xBTC",
    date: "April 30, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/wbtc-risk-report.pdf",
  },
  {
    title: "Tokenized Equity: SPYx, QQQx, NVDAx, TSLAx (xStocks)",
    date: "April 15, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/xstocks-risk-report.pdf",
  },
  {
    title: "PayFi Strategy Token ($PST)",
    date: "April 3, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/payfi-risk-report.pdf",
  },
  {
    title: "Maple Finance syrupUSD",
    date: "February 14, 2026",
    url: "https://static-r2.jup.ag/lend/risk-research/maple-risk-report.pdf",
  },
];

const DASHBOARDS = [
  "https://blockworks.com/analytics/jupiter/jupiter-lend",
  "https://tokenterminal.com/explorer/projects/jupiter/jupiterlend/metrics/all",
  "https://defillama.com/protocol/jupiter-lend",
  "https://dune.com/0xfluid/jupiter-lend",
];

export function lendTransparency(market: LendMarket) {
  const program =
    market === "main"
      ? {
          address: "HqPrpa4ESBDnRHRWaiYtjv4xe93wvCS9NNZtDwR89cVa",
          threshold: "5/8",
        }
      : {
          address: "Df2CV9urF8fQw5dHdqpoSNcmv9J6B46LchG1Kkn8Uafu",
          threshold: "4/6",
        };
  const upgrade =
    market === "main"
      ? "4MsgBB5VPoTrUSp5XnfbViV386C1UnsTdifLBw33ZMSJ"
      : "A4CcB3kdi3w4fJgAim4sdN8DvadZnN4R4PPbECQqz6j7";
  return {
    market,
    multisigs: [
      {
        name: "Ops Multisig",
        role: "Incentives, reward configuration and treasury operations",
        address: "Cvnta5ecoiCgNbLEXYm6kvhJMmRv3JM3ksKgTLVPg4hk",
        threshold: "3/7",
        timelock: null,
      },
      {
        name: "Program Multisig",
        role: "Program-level configuration",
        address: program.address,
        threshold: program.threshold,
        timelock: "6 hours",
      },
      ...(market === "main"
        ? [
            {
              name: "Program Multisig II",
              role: "Deploys new markets; cannot change limits or configs",
              address: "3H8C6yYTXUcN9RRRDmcLDt3e4aZLYRRX4x2HbEjTqQAA",
              threshold: "3/5",
              timelock: null,
            },
          ]
        : []),
      {
        name: "Upgrade Multisig",
        role: "Protocol upgrade authority",
        address: upgrade,
        threshold: "4/7",
        timelock: "12 hours",
      },
    ],
    audits: AUDITS,
    oracles: ["Chainlink", "Pyth Network", "RedStone"],
    riskReports: RISK_REPORTS,
    dashboards: DASHBOARDS,
  };
}
