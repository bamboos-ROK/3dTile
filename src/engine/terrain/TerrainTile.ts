import type { Mesh } from '@babylonjs/core/Meshes/mesh';

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
  const [tileX, tileY, level] = key.split('_').map(Number);
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
