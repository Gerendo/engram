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

**Prerequisites:** A [Voyage AI API key](https://voyageai.com) (free tier covers millions of tokens).

```bash
# 1. Clone Engram alongside your repo
git clone https://github.com/Gerendo/engram ~/engram

# 2. Install Engram's dependencies
cd ~/engram && npm install

# 3. In your target repo, run the setup wizard
cd /your/project
npx tsx ~/engram/src/init.ts
```

The wizard will:
- Create `engram.config.json` in your repo
- Register the MCP server in `.claude/settings.json`
- Add `data/engram.db` to `.gitignore`

```bash
# 4. Add your Voyage API key to .env.local
echo "VOYAGE_API_KEY=your_key_here" >> .env.local

# 5. Build the index
VOYAGE_API_KEY=your_key_here npx tsx ~/engram/src/index.ts

# 6. Reload Claude Code - the search_<yourproject> tool is now live
```

## Claude Code - VS Code extension

The setup above works for both the **Claude Code CLI** and the **Claude Code VS Code extension** - they both read from `.claude/settings.json` in your project root.

After running `engram:init`, your `.claude/settings.json` will contain:

```json
{
  "enableAllProjectMcpServers": true,
  "mcpServers": {
    "myproject": {
      "command": "bash",
      "args": ["-c", "set -a && . /your/project/.env.local && set +a && npx tsx ~/engram/src/mcp.ts"],
      "cwd": "/your/project"
    }
  }
}
```

**To activate in VS Code:**
1. Open your project folder in VS Code
2. Open the Claude Code panel (sidebar or `Cmd+Shift+P` → "Claude Code")
3. The `search_<yourproject>` tool appears automatically - no extra steps

**If the tool doesn't appear**, check:
- `enableAllProjectMcpServers` is `true` in `.claude/settings.json`
- The `VOYAGE_API_KEY` is present in `.env.local`
- The index has been built (`data/engram.db` exists)

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
