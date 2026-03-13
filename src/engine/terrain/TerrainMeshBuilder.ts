import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { TileCoord } from './TerrainTile';
import { tileKey } from './TerrainTile';

const VERTEX_RESOLUTION = 32; // 타일당 32×32 vertices
const HEIGHTMAP_SIZE = 256;
const HEIGHT_SCALE = 50;

export interface HeightmapData {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 256×256 heightmap PNG를 로드하여 픽셀 데이터 반환 */
export async function loadHeightmap(url: string): Promise<HeightmapData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({ pixels: imageData.data, width: img.width, height: img.height });
    };
    img.onerror = () => reject(new Error(`Failed to load heightmap: ${url}`));
    img.src = url;
  });
}

/** heightmap 픽셀 좌표에서 높이값 샘플링 (0~HEIGHT_SCALE) */
function sampleHeight(
  hm: HeightmapData,
  px: number,
  py: number
): number {
  const x = Math.min(Math.max(Math.floor(px), 0), hm.width - 1);
  const y = Math.min(Math.max(Math.floor(py), 0), hm.height - 1);
  const idx = (y * hm.width + x) * 4; // RGBA
  return (hm.pixels[idx] / 255) * HEIGHT_SCALE;
}

/**
 * 타일 좌표 기반으로 32×32 grid terrain mesh 생성
 *
 * heightmap UV 매핑:
 *   tileSize = 256 / 2^level
 *   샘플 시작: (tileX * tileSize, tileY * tileSize)
 */
export function buildTerrainMesh(
  scene: Scene,
  coord: TileCoord,
  hm: HeightmapData,
  worldMinX: number,
  worldMinZ: number,
  worldTileSize: number
): Mesh {
  const n = VERTEX_RESOLUTION; // 32
  const cells = n - 1; // 31

  // heightmap 샘플 영역 계산
  const hmTileSize = HEIGHTMAP_SIZE / Math.pow(2, coord.level);
  const hmStartX = coord.tileX * hmTileSize;
  const hmStartY = coord.tileY * hmTileSize;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // vertices 생성
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      // world 좌표
      const wx = worldMinX + (col / cells) * worldTileSize;
      const wz = worldMinZ + (row / cells) * worldTileSize;

      // heightmap 픽셀 좌표
      const px = hmStartX + (col / cells) * hmTileSize;
      const py = hmStartY + (row / cells) * hmTileSize;
      const wy = sampleHeight(hm, px, py);

      positions.push(wx, wy, wz);
      normals.push(0, 1, 0); // 임시 법선, computeNormals로 재계산
      uvs.push(col / cells, row / cells);
    }
  }

  // triangle indices (cell당 2개 삼각형)
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const tl = row * n + col;
      const tr = tl + 1;
      const bl = tl + n;
      const br = bl + 1;
      // 삼각형 1
      indices.push(tl, bl, tr);
      // 삼각형 2
      indices.push(tr, bl, br);
    }
  }

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  vertexData.normals = normals;

  const mesh = new Mesh(`tile_${tileKey(coord)}`, scene);
  vertexData.applyToMesh(mesh, false);
  mesh.isPickable = false;

  return mesh;
}
