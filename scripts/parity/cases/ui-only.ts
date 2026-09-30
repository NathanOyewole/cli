import type { ParityCase } from "../types.ts";

const browserOnly = (feature: string, reason: string): ParityCase => ({
  id: feature,
  feature,
  kind: "unsupported",
  reason,
});

export const cases: ParityCase[] = [
  browserOnly("swap-reverse", "form control; the CLI swaps --from and --to"),
  browserOnly(
    "recurring-reverse",
    "form control; the CLI swaps --from and --to"
  ),
  browserOnly(
    "shared-settings",
    "web display settings; CLI settings live in `jup config`"
  ),
  browserOnly("shared-wallet", "wallet drawer; the CLI uses `jup keys`"),
  browserOnly(
    "shared-auth",
    "browser wallet and Jupiter ID connection; the CLI signs with local keys"
  ),
  browserOnly("shared-support", "help widget"),
  browserOnly(
    "shared-feedback",
    "UI loading and toast states; the CLI reports via exit code and `error`"
  ),
  browserOnly("shared-responsive", "layout and navigation"),
  browserOnly("redirect-product", "web URL redirects"),
  browserOnly("redirect-lend", "web URL redirects"),
  browserOnly("redirect-gift", "web URL redirects"),
  browserOnly("redirect-external", "web URL redirects"),
  browserOnly("redirect-locale", "web URL redirects"),
  browserOnly("redirect-campaign", "web URL redirects"),
  browserOnly("redirect-spot-special", "web URL redirects"),
  browserOnly("redirect-encoded-braces", "web URL redirects"),
  browserOnly("mobile-content", "mobile app marketing pages"),
  browserOnly("mobile-download", "mobile app download links"),
  browserOnly("mobile-moonpay", "mobile campaign redirect"),
  browserOnly("mobile-invite", "mobile app invitation page"),
  browserOnly("access-appeal", "web access-suspension page"),
  browserOnly("access-not-found", "web 404 page"),
  browserOnly("directory-search", "web product directory"),
  browserOnly("navigation-links", "web navigation"),
  browserOnly("account-dialog", "web connect dialog"),
  browserOnly("wallet-landing", "browser wallet marketing page"),
  browserOnly(
    "external-products",
    "links to separate apps (Stake JUP, Offerbook, JupUSD, Spend)"
  ),
  browserOnly("content-pages", "home and updates content"),
  browserOnly(
    "portfolio-invalid-button",
    "web form validation; the CLI validates --address"
  ),
  browserOnly("portfolio-invalid-keyboard", "web form validation"),
  browserOnly("portfolio-reset", "web form validation"),
  browserOnly("stake-jup-link", "outbound link to the separate Stake JUP app"),
];
