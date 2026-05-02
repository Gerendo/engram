import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const REPO_ROOT = process.cwd();
const ENGRAM_ROOT = path.resolve(import.meta.dirname, "../");

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("\nEngram setup\n");

const defaultName = path.basename(REPO_ROOT);
const rawName = await ask(rl, `Project name [${defaultName}]: `);
const name = rawName.trim() || defaultName;

const configPath = path.join(REPO_ROOT, "engram.config.json");

if (fs.existsSync(configPath)) {
  const overwrite = await ask(rl, "engram.config.json already exists. Overwrite? [y/N]: ");
  if (overwrite.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    rl.close();
    process.exit(0);
  }
}

const config = {
  name,
  include: ["*.md", "docs/**/*.md", "src/**/*.ts", "src/**/*.tsx"],
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
  db: "data/engram.db",
  topK: 5,
  maxPerFile: 2,
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(`\nCreated engram.config.json`);

// Wire MCP into .claude/settings.json
const claudeDir = path.join(REPO_ROOT, ".claude");
const settingsPath = path.join(claudeDir, "settings.json");

fs.mkdirSync(claudeDir, { recursive: true });

let settings: Record<string, unknown> = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
}

const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
mcpServers[name] = {
  command: "sh",
  args: [
    "-c",
    `set -a && . "${REPO_ROOT}/.env.local" && set +a && npx tsx "${ENGRAM_ROOT}/src/mcp.ts"`,
  ],
  cwd: REPO_ROOT,
};
settings.mcpServers = mcpServers;

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`Registered MCP server "${name}" in .claude/settings.json`);

// Add data/ to .gitignore if not already there
const gitignorePath = path.join(REPO_ROOT, ".gitignore");
if (fs.existsSync(gitignorePath)) {
  const content = fs.readFileSync(gitignorePath, "utf-8");
  if (!content.includes("data/engram.db")) {
    fs.appendFileSync(gitignorePath, "\n# Engram index\ndata/engram.db\n");
    console.log("Added data/engram.db to .gitignore");
  }
}

rl.close();

console.log(`
Next steps:
  1. Add VOYAGE_API_KEY to your .env.local
  2. Run: npm run engram:index
  3. Restart Claude Code — the search_${name} tool will be available
`);
