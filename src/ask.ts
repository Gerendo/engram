import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { embedTexts } from "./embed.js";
import { openDb, allChunks } from "./db.js";
import { loadConfig, resolveDb } from "./config.js";
import type { Pointer } from "./types.js";

const REPO_ROOT = process.cwd();
const config = loadConfig(REPO_ROOT);
const DB_PATH = resolveDb(REPO_ROOT, config);

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

if (!VOYAGE_API_KEY) { console.error("VOYAGE_API_KEY is not set"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set"); process.exit(1); }

const question = process.argv.slice(2).join(" ").trim();
if (!question) { console.error("Usage: npm run engram:ask <your question>"); process.exit(1); }

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function readChunkText(pointer: Pointer): string {
  const buf = Buffer.alloc(pointer.byteEnd - pointer.byteStart);
  const fd = fs.openSync(pointer.path, "r");
  fs.readSync(fd, buf, 0, buf.length, pointer.byteStart);
  fs.closeSync(fd);
  return buf.toString("utf-8");
}

const db = openDb(DB_PATH);
const rows = allChunks(db);

if (rows.length === 0) {
  console.error("No chunks in DB. Run: npm run engram:index");
  process.exit(1);
}

console.log(`\nSearching ${rows.length} chunks for: "${question}"\n`);

const { embeddings: [questionEmbedding] } = await embedTexts([question], VOYAGE_API_KEY);

const scored = rows
  .map((row) => ({ row, score: cosineSimilarity(questionEmbedding, row.embedding) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, config.topK);

const contexts = scored.map(({ row, score }) => {
  const pointer: Pointer = JSON.parse(row.pointerJson);
  const text = readChunkText(pointer);
  const relPath = path.relative(REPO_ROOT, pointer.path) || pointer.path;
  return { text, relPath, pointer, score };
});

console.log("Top matches:");
for (const { relPath, score } of contexts) {
  console.log(`  ${relPath} (score: ${score.toFixed(3)})`);
}
console.log();

const contextBlock = contexts
  .map(({ text, relPath, pointer }, i) =>
    `[${i + 1}] ${relPath} (bytes ${pointer.byteStart}-${pointer.byteEnd})\n${text}`
  )
  .join("\n\n---\n\n");

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const systemPrompt =
  `You are a helpful assistant for the ${config.name} project. ` +
  "Answer the question using ONLY the provided context passages. " +
  "Cite sources as [1], [2], etc. If the answer is not in the context, say so plainly.";

const response = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
  messages: [{
    role: "user",
    content: [
      { type: "text", text: `Context passages:\n\n${contextBlock}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Question: ${question}` },
    ],
  }],
});

const answer = response.content.find((b) => b.type === "text");
console.log("Answer:\n");
console.log(answer?.text ?? "(no response)");

const u = response.usage;
const inputCost = ((u.input_tokens / 1_000_000) * 3).toFixed(5);
const outputCost = ((u.output_tokens / 1_000_000) * 15).toFixed(5);
const cacheWriteCost = (((u.cache_creation_input_tokens ?? 0) / 1_000_000) * 3.75).toFixed(5);
const cacheReadCost = (((u.cache_read_input_tokens ?? 0) / 1_000_000) * 0.30).toFixed(5);

console.log(
  `\n[tokens: ${u.input_tokens} in / ${u.output_tokens} out` +
  ` | cache write: ${u.cache_creation_input_tokens ?? 0} / cache read: ${u.cache_read_input_tokens ?? 0}` +
  ` | cost: ~$${(parseFloat(inputCost) + parseFloat(outputCost) + parseFloat(cacheWriteCost) + parseFloat(cacheReadCost)).toFixed(5)}]`
);
