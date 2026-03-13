import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { BoundingBox } from '@babylonjs/core/Culling/boundingBox';

export interface TileCoord {
  tileX: number;
  tileY: number;
  level: number;
}

export enum TileState {
  Created = 'Created',
  Loading = 'Loading',
  Active = 'Active',
  Visible = 'Visible',
  Disposed = 'Disposed',
}

export function tileKey(coord: TileCoord): string {
  return `${coord.tileX}_${coord.tileY}_${coord.level}`;
}

export class TerrainTile {
  coord: TileCoord;
  state: TileState;
  mesh: Mesh | null = null;
  boundingBox: BoundingBox | null = null;

  constructor(coord: TileCoord) {
    this.coord = coord;
    this.state = TileState.Created;
  }
}
