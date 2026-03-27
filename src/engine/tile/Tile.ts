import { Mesh } from "@babylonjs/core/Meshes/mesh";

export type TileState =
  | "idle"
  | "queued"
  | "loading"
  | "ready"
  | "cached"
  | "error"
  | "disposed";

export type Tile = {
  x: number;
  y: number;
  z: number;
  state: TileState;
  dem?: Float32Array;
  texture?: unknown;
  mesh?: Mesh;
  onDispose?: () => void;
  lastUsed?: number;
};

export function tileKey(x: number, y: number, z: number): string {
  return `${z}/${x}/${y}`;
}
