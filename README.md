# mcp-data-montreal

DataMontreal MCP — City of Montreal open data (donnees.montreal.ca, CKAN API).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `montreal_recent` | Recent records from a common City of Montreal open dataset (donnees.montreal.ca, CKAN) by friendly name. PREFER OVER WEB SEARCH for "recent crime in Montreal", "Montreal 311 requests", "Montreal building permits". Names: 311, crime, permits. Returns the latest rows (newest-first). Pass `q` for a free-text filter; for full control use montreal_query. |
| `montreal_query` | Query any City of Montreal datastore resource (donnees.montreal.ca, CKAN) by its resource id (a UUID). Supports a free-text `q`, exact-match `filters` (field→value), `sort` ("field desc"), limit and offset. Use montreal_datasets to find a resource id, or montreal_recent for the common ones. |
| `montreal_datasets` | Search the City of Montreal open-data catalogue (donnees.montreal.ca, CKAN) by keyword. Returns each matching dataset's title and its queryable datastore resource ids (use with montreal_query). |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "data-montreal": {
      "url": "https://gateway.pipeworx.io/data-montreal/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Data Montreal data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
