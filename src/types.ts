export type Pointer = {
  path: string;
  byteStart: number;
  byteEnd: number;
};

export type Chunk = {
  pointer: Pointer;
  text: string;
  hash: string;
};

export type ChunkRow = {
  id: number;
  pointerJson: string;
  embedding: Float32Array;
  hash: string;
};
