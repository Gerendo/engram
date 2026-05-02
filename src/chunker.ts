import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { Chunk } from "./types.js";
import type { EngramConfig } from "./config.js";

const TARGET_MIN = 1600;
const TARGET_MAX = 2400;

const EXPORT_DECLARATION_REGEX =
  /^export\s+(async\s+)?(function|const|class|type|interface|default)\s+\w+/gm;

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".cache"]);

function matchesGlob(filePath: string, pattern: string): boolean {
  // Handle **/ prefix
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    return matchesGlob(filePath, suffix) || filePath.includes("/" + suffix.replace(/\*/g, ""));
  }
  // Simple extension patterns: *.ts, *.md
  if (pattern.startsWith("*.")) {
    return filePath.endsWith(pattern.slice(1));
  }
  // Glob with directory: src/**/*.ts
  const parts = pattern.split("**/");
  if (parts.length === 2) {
    const [prefix, suffix] = parts;
    const ext = suffix.replace("*.", ".");
    return filePath.includes("/" + prefix.replace(/\/$/, "") + "/") && filePath.endsWith(ext);
  }
  return filePath.endsWith(pattern);
}

function walkDir(dir: string, results: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkDir(full, results);
    else if (stat.isFile()) results.push(full);
  }
}

export function collectFiles(repoRoot: string, config: EngramConfig): string[] {
  const allFiles: string[] = [];
  walkDir(repoRoot, allFiles);

  return allFiles.filter((f) => {
    const rel = path.relative(repoRoot, f);
    const included = config.include.some((p) => matchesGlob(rel, p) || matchesGlob(f, p));
    const excluded = config.exclude.some((p) => matchesGlob(rel, p) || matchesGlob(f, p));
    return included && !excluded;
  });
}

function byteOffsetOf(content: string, charOffset: number): number {
  return Buffer.byteLength(content.slice(0, charOffset), "utf-8");
}

function makeHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function chunkCodeFile(absPath: string): Chunk[] {
  const content = fs.readFileSync(absPath, "utf-8");
  const chunks: Chunk[] = [];

  function addChunk(text: string, byteStart: number, byteEnd: number): void {
    if (text.trim().length === 0) return;
    chunks.push({ pointer: { path: absPath, byteStart, byteEnd }, text, hash: makeHash(text) });
  }

  const matches: Array<{ index: number }> = [];
  let match;
  while ((match = EXPORT_DECLARATION_REGEX.exec(content)) !== null) {
    matches.push({ index: match.index });
  }

  if (matches.length === 0) {
    chunks.push({
      pointer: { path: absPath, byteStart: 0, byteEnd: Buffer.byteLength(content, "utf-8") },
      text: content,
      hash: makeHash(content),
    });
    return chunks;
  }

  if (matches[0].index > 0) {
    const preamble = content.slice(0, matches[0].index);
    addChunk(preamble, 0, byteOffsetOf(content, matches[0].index));
  }

  for (let i = 0; i < matches.length; i++) {
    const startChar = matches[i].index;
    const endChar = i < matches.length - 1 ? matches[i + 1].index : content.length;
    let text = content.slice(startChar, endChar).trimEnd();
    if (text.length > 3000) text = text.slice(0, 3000) + "\n// ... (truncated)";
    const byteStart = byteOffsetOf(content, startChar);
    const byteEnd = byteOffsetOf(content, startChar + text.length);
    addChunk(text, byteStart, byteEnd);
  }

  return chunks;
}

function chunkParagraphFile(absPath: string): Chunk[] {
  const content = fs.readFileSync(absPath, "utf-8");
  const paragraphs = content.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let buffer = "";
  let pendingStart = 0;
  let charCursor = 0;

  function flush(byteEnd: number): void {
    chunks.push({
      pointer: { path: absPath, byteStart: pendingStart, byteEnd },
      text: buffer,
      hash: makeHash(buffer),
    });
    pendingStart = byteEnd;
    buffer = "";
  }

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const separator = i < paragraphs.length - 1 ? "\n\n" : "";
    if (buffer === "") buffer = para;
    else if (buffer.length + 2 + para.length > TARGET_MAX) {
      flush(byteOffsetOf(content, charCursor));
      buffer = para;
    } else {
      buffer = buffer + "\n\n" + para;
    }
    charCursor += para.length + separator.length;
    if (buffer.length >= TARGET_MIN && i < paragraphs.length - 1) {
      flush(byteOffsetOf(content, charCursor));
    }
  }

  if (buffer.length > 0) flush(Buffer.byteLength(content, "utf-8"));
  return chunks;
}

export function chunkFile(absPath: string): Chunk[] {
  if (absPath.endsWith(".ts") || absPath.endsWith(".tsx")) return chunkCodeFile(absPath);
  return chunkParagraphFile(absPath);
}
