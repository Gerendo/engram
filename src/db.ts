import * as fs from "fs";
import Database from "better-sqlite3";
import type { ChunkRow } from "./types.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pointer_json TEXT NOT NULL,
    embedding BLOB NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    indexed_at INTEGER NOT NULL
  );
`;

export function openDb(absPath: string): Database.Database {
  const db = new Database(absPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function insertChunk(
  db: Database.Database,
  pointerJson: string,
  embedding: Float32Array,
  hash: string
): void {
  db.prepare(
    `INSERT OR IGNORE INTO chunks (pointer_json, embedding, hash, indexed_at)
     VALUES (?, ?, ?, ?)`
  ).run(pointerJson, Buffer.from(embedding.buffer), hash, Date.now());
}

export function allChunks(db: Database.Database): ChunkRow[] {
  const rows = db
    .prepare("SELECT id, pointer_json, embedding, hash FROM chunks")
    .all() as Array<{ id: number; pointer_json: string; embedding: Buffer; hash: string }>;

  return rows.map((row) => ({
    id: row.id,
    pointerJson: row.pointer_json,
    embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
    hash: row.hash,
  }));
}

export function pruneUnlistedFiles(db: Database.Database, listedPaths: Set<string>): number {
  const rows = db.prepare("SELECT id, pointer_json FROM chunks").all() as Array<{ id: number; pointer_json: string }>;
  const toDelete = rows
    .filter((row) => !listedPaths.has((JSON.parse(row.pointer_json) as { path: string }).path))
    .map((row) => row.id);
  if (toDelete.length === 0) return 0;
  db.prepare(`DELETE FROM chunks WHERE id IN (${toDelete.map(() => "?").join(",")})`).run(...toDelete);
  return toDelete.length;
}

export function pruneDeletedFiles(db: Database.Database): number {
  const rows = db.prepare("SELECT id, pointer_json FROM chunks").all() as Array<{ id: number; pointer_json: string }>;
  const toDelete = rows
    .filter((row) => !fs.existsSync((JSON.parse(row.pointer_json) as { path: string }).path))
    .map((row) => row.id);
  if (toDelete.length === 0) return 0;
  db.prepare(`DELETE FROM chunks WHERE id IN (${toDelete.map(() => "?").join(",")})`).run(...toDelete);
  return toDelete.length;
}

export function pruneStaleChunks(db: Database.Database, filePath: string, currentHashes: Set<string>): number {
  const rows = db.prepare("SELECT id, hash, pointer_json FROM chunks").all() as Array<{ id: number; hash: string; pointer_json: string }>;
  const toDelete: number[] = [];
  for (const row of rows) {
    const pointer = JSON.parse(row.pointer_json) as { path: string };
    if (pointer.path === filePath && !currentHashes.has(row.hash)) {
      toDelete.push(row.id);
    }
  }
  if (toDelete.length === 0) return 0;
  db.prepare(`DELETE FROM chunks WHERE id IN (${toDelete.map(() => "?").join(",")})`).run(...toDelete);
  return toDelete.length;
}
