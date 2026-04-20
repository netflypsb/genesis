# K-01: Universal Document & Codebase Intelligence MCP Server

K-01 gives any MCP-compatible AI agent the ability to **fully, reliably analyse massive documents and large codebases** — with zero content overlooked.

58 tools. 12 prompt templates. Offline-first. One `npm install`.

## Quick Start

```bash
git clone https://github.com/netflypsb/K-01.git
cd K-01/k-01
npm install
```

Then add to your MCP client config:

```json
{
  "mcpServers": {
    "k-01": {
      "command": "node",
      "args": ["<FULL_PATH_TO_K-01>/k-01/dist/server.js"]
    }
  }
}
```

**Full documentation, tool reference, and setup instructions: [k-01/README.md](k-01/README.md)**

## Agent Setup Prompt

Copy-paste this to any AI agent:

> **Clone and set up the K-01 MCP server:**
> 1. `git clone https://github.com/netflypsb/K-01.git`
> 2. `cd K-01/k-01 && npm install`
> 3. Add K-01 to MCP config: command `node`, args `["<path>/k-01/dist/server.js"]`
> 4. Restart MCP client, then verify with `k01_list_sources`

## License

MIT
