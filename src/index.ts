import * as path from "path";
import * as fs from "fs";
import { collectFiles, chunkFile } from "./chunker.js";
import { embedTexts } from "./embed.js";
import { openDb, insertChunk, pruneDeletedFiles, pruneStaleChunks, pruneUnlistedFiles } from "./db.js";
import { loadConfig, resolveDb } from "./config.js";

const REPO_ROOT = process.cwd();
const config = loadConfig(REPO_ROOT);
const DB_PATH = resolveDb(REPO_ROOT, config);

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "";
if (!VOYAGE_API_KEY) {
  console.error("VOYAGE_API_KEY is not set in environment");
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

const pruned = pruneDeletedFiles(db);
if (pruned > 0) console.log(`Pruned ${pruned} chunk(s) from deleted files`);

const files = collectFiles(REPO_ROOT, config);
const unlistedPruned = pruneUnlistedFiles(db, new Set(files));
if (unlistedPruned > 0) console.log(`Pruned ${unlistedPruned} chunk(s) from de-listed files`);

console.log(`\nFound ${files.length} files to index:`);
for (const f of files) console.log(" ", path.relative(REPO_ROOT, f) || f);

let totalChunks = 0;
let skipped = 0;
let inserted = 0;
let totalTokens = 0;

for (const absPath of files) {
  const rel = path.relative(REPO_ROOT, absPath) || absPath;
  const chunks = chunkFile(absPath);
  if (chunks.length === 0) continue;

  const stale = pruneStaleChunks(db, absPath, new Set(chunks.map((c) => c.hash)));
  if (stale > 0) process.stdout.write(`\n${rel} — pruned ${stale} stale chunk(s)`);

  process.stdout.write(`\n${rel} — ${chunks.length} chunk(s)\n`);

  const texts = chunks.map((c) => c.text);
  const { embeddings, totalTokens: batchTokens } = await embedTexts(texts, VOYAGE_API_KEY);
  totalTokens += batchTokens;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const pointerJson = JSON.stringify(chunk.pointer);
    const before = db.prepare("SELECT 1 FROM chunks WHERE hash = ?").get(chunk.hash);
    insertChunk(db, pointerJson, embeddings[i], chunk.hash);
    if (before) {
      process.stdout.write(`  [skip] chunk ${i + 1} (unchanged)\n`);
      skipped++;
    } else {
      process.stdout.write(
        `  [index] chunk ${i + 1} bytes ${chunk.pointer.byteStart}-${chunk.pointer.byteEnd}\n`
      );
      inserted++;
    }
    totalChunks++;
  }
}

const cost = ((totalTokens / 1_000_000) * 0.02).toFixed(4);
console.log(`\nDone. ${inserted} indexed, ${skipped} skipped. Voyage tokens: ${totalTokens} (~$${cost})`);
