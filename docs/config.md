# Config

Settings are stored at `~/.config/jup/settings.json`.

## Commands

### View current settings

```bash
jup config list
```

```js
// Example JSON response:
{
  "activeKey": "default",
  "output": "table", // "table" or "json"
  "apiKey": "<set>", // redacted; omitted when no API key is set
  "rpcUrl": "https://..." // omitted when unset (public mainnet RPC is used)
}
```

`config set` prints the updated settings in the same shape.

### Set output format

```bash
jup config set --output json
jup config set --output table
```

Override the format for a single command with the global `-f, --format <table|json>` flag, e.g. `jup spot portfolio -f json`.

### Set active key

```bash
jup config set --active-key <name>
```

### Set API key

Use an API key from <https://portal.jup.ag/> for higher rate limits:

```bash
jup config set --api-key <key>

# Delete or unset the API key
jup config set --api-key
```

### Set RPC URL

Commands that send transactions straight to Solana (instead of a Jupiter execute endpoint) use this RPC. Defaults to the public mainnet RPC, which is rate limited:

```bash
jup config set --rpc-url <url>

# Unset to use the default
jup config set --rpc-url
```
