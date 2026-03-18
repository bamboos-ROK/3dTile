import type { Mesh } from '@babylonjs/core/Meshes/mesh';

/** 각 방향의 이웃 타일이 1레벨 더 거친지(level-1) 여부 */
export interface CoarserBorders {
  N: boolean;
  S: boolean;
  W: boolean;
  E: boolean;
}

export interface TileCoord {
  tileX: number;
  tileY: number;
  level: number;
}

export enum TileState {
  Created = 'Created',
  Active = 'Active',
  Visible = 'Visible',
  Disposed = 'Disposed',
}

export function tileKey(coord: TileCoord): string {
  return `${coord.tileX}_${coord.tileY}_${coord.level}`;
}

export function parseTileKey(key: string): TileCoord {
  const parts = key.split('_');
  if (parts.length !== 3) throw new Error(`Invalid tile key format: ${key}`);
  const [tileX, tileY, level] = parts.map(Number);
  if (isNaN(tileX) || isNaN(tileY) || isNaN(level)) throw new Error(`Invalid tile key values: ${key}`);
  return { tileX, tileY, level };
}

export class TerrainTile {
  coord: TileCoord;
  state: TileState;
  mesh: Mesh | null = null;

  constructor(coord: TileCoord) {
    this.coord = coord;
    this.state = TileState.Created;
  }
}
