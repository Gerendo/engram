# Engram

Semantic RAG index for any repo, wired into Claude Code as an MCP tool.

Point it at your codebase, run one command, and Claude Code gets a `search_<yourproject>` tool that retrieves cited passages from your own files - no cloud, no database server, no config hell.

## How it works

```
your repo  →  Voyage (voyage-3-lite)  →  SQLite (embeddings + byte pointers)
question   →  Voyage                  →  cosine search  →  top passages  →  Claude Code
```

Raw text is never stored - only a 512-dimension embedding and a `{file, byteStart, byteEnd}` pointer. The file is always the source of truth.

## Setup

**In your target repo:**

```bash
# 1. Install engram as a dependency or clone it alongside your repo
npm install --save-dev /path/to/engram   # local, or publish to npm later

# 2. Run the setup wizard
npx tsx /path/to/engram/src/init.ts

# 3. Add your Voyage API key
echo "VOYAGE_API_KEY=your_key_here" >> .env.local

# 4. Build the index
npm run engram:index

# 5. Restart Claude Code
# The search_<yourproject> MCP tool is now available
```

Get a Voyage API key at [voyageai.com](https://voyageai.com). The free tier covers millions of tokens.

## Commands

| Command | What it does |
|---|---|
| `npm run engram:init` | Setup wizard - creates config, wires MCP |
| `npm run engram:index` | Build or update the index |
| `npm run engram:ask "question"` | Ask a question from the terminal (uses Claude Haiku) |

## Config

`engram.config.json` in your repo root:

```json
{
  "name": "myproject",
  "include": ["*.md", "docs/**/*.md", "src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
  "db": "data/engram.db",
  "topK": 5,
  "maxPerFile": 2
}
```

- `name` - becomes the MCP tool name: `search_<name>`
- `include` - glob patterns for files to index
- `exclude` - glob patterns to skip
- `topK` - number of passages returned per query
- `maxPerFile` - max passages from any single file (prevents one file dominating)

## Cost

- **Indexing:** Voyage voyage-3-lite at $0.02 / 1M tokens. A 200-file TypeScript repo costs ~$0.01 to index from scratch. Incremental re-indexing only embeds changed chunks.
- **Search (MCP):** One Voyage embed call per query (~100 tokens). Essentially free.
- **Search (ask CLI):** Voyage embed + Claude Haiku for the answer. Typically $0.001-0.003 per question.

## CLAUDE.md integration

Add this to your `CLAUDE.md` to make Claude Code always query the index first:

```markdown
> **Always call `search_<yourproject>` before answering any question about this codebase.**
```

## Stack

- [Voyage AI](https://voyageai.com) - embeddings (voyage-3-lite, 512 dims)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - local vector store
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Claude Code integration
- [Anthropic SDK](https://github.com/anthropic-ai/sdk-python) - for the ask CLI
