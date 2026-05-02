import * as fs from "fs";
import * as path from "path";

export type EngramConfig = {
  name: string;
  include: string[];
  exclude: string[];
  db: string;
  topK: number;
  maxPerFile: number;
};

const DEFAULTS: Omit<EngramConfig, "name"> = {
  include: ["*.md", "src/**/*.ts", "src/**/*.tsx"],
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
  db: "data/engram.db",
  topK: 5,
  maxPerFile: 2,
};

export function loadConfig(repoRoot: string): EngramConfig {
  const configPath = path.join(repoRoot, "engram.config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `engram.config.json not found at ${configPath}.\nRun: npm run engram:init`
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<EngramConfig>;

  if (!raw.name) throw new Error("engram.config.json must include a \"name\" field");

  return {
    name: raw.name,
    include: raw.include ?? DEFAULTS.include,
    exclude: raw.exclude ?? DEFAULTS.exclude,
    db: raw.db ?? DEFAULTS.db,
    topK: raw.topK ?? DEFAULTS.topK,
    maxPerFile: raw.maxPerFile ?? DEFAULTS.maxPerFile,
  };
}

export function resolveDb(repoRoot: string, config: EngramConfig): string {
  return path.isAbsolute(config.db)
    ? config.db
    : path.join(repoRoot, config.db);
}
