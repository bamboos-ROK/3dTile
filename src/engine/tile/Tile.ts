import { Mesh } from "@babylonjs/core/Meshes/mesh";

export type TileState = "idle" | "loading" | "ready" | "error";

export type Tile = {
  x: number;
  y: number;
  z: number;
  state: TileState;
  dem?: Float32Array;
  texture?: unknown;
  mesh?: Mesh;
};

export function tileKey(x: number, y: number, z: number): string {
  return `${z}/${x}/${y}`;
}
