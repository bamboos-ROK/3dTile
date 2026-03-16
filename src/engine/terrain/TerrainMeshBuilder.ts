import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { TileCoord } from "./TerrainTile";
import { tileKey } from "./TerrainTile";
import { HEIGHT_SCALE, TERRAIN_SIZE, VERTEX_RESOLUTION, PIXEL_WORLD_SIZE } from "../constants";

export interface HeightmapData {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** heightmap PNG를 로드하여 픽셀 데이터 반환 */
export async function loadHeightmap(url: string): Promise<HeightmapData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      resolve({ pixels: imageData.data, width: img.width, height: img.height });
    };
    img.onerror = () => reject(new Error(`Failed to load heightmap: ${url}`));
    img.src = url;
  });
}

/** heightmap 픽셀 좌표에서 높이값 샘플링 (0~HEIGHT_SCALE) */
function sampleHeight(hm: HeightmapData, px: number, py: number): number {
  const x = Math.min(Math.max(Math.floor(px), 0), hm.width - 1);
  const y = Math.min(Math.max(Math.floor(py), 0), hm.height - 1);
  const idx = (y * hm.width + x) * 4; // RGBA
  return (hm.pixels[idx] / 255) * HEIGHT_SCALE;
}

/** heightmap 픽셀 좌표에서 전역 법선 계산 (중앙차분법) */
function computeHeightmapNormal(
  hm: HeightmapData,
  px: number,
  py: number,
): [number, number, number] {
  const hL = sampleHeight(hm, px - 1, py);
  const hR = sampleHeight(hm, px + 1, py);
  const hD = sampleHeight(hm, px, py - 1);
  const hU = sampleHeight(hm, px, py + 1);
  const dydx = (hR - hL) / (2 * PIXEL_WORLD_SIZE);
  const dydz = (hU - hD) / (2 * PIXEL_WORLD_SIZE);
  const nx = -dydx,
    ny = 1.0,
    nz = -dydz;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / len, ny / len, nz / len];
}

/**
 * 타일 좌표 기반으로 32×32 grid terrain mesh 생성
 *
 * heightmap UV 매핑:
 *   tileSize = hm.width / 2^level
 *   샘플 시작: (tileX * tileSize, tileY * tileSize)
 */
export function buildTerrainMesh(
  scene: Scene,
  coord: TileCoord,
  hm: HeightmapData,
  worldMinX: number,
  worldMinZ: number,
  worldTileSize: number,
  material: StandardMaterial,
): Mesh {
  const n = VERTEX_RESOLUTION; // 32
  const cells = n - 1; // 31

  // heightmap 샘플 영역 계산 (실제 이미지 크기 기준)
  const hmTileSize = hm.width / Math.pow(2, coord.level);
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
      const [nx, ny, nz] = computeHeightmapNormal(hm, px, py);

      positions.push(wx, wy, wz);
      normals.push(nx, ny, nz);
      uvs.push((wz + TERRAIN_SIZE / 2) / TERRAIN_SIZE, 1.0 - (wx + TERRAIN_SIZE / 2) / TERRAIN_SIZE);
    }
  }

  // triangle indices (cell당 2개 삼각형)
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const tl = row * n + col;
      const tr = tl + 1;
      const bl = tl + n;
      const br = bl + 1;
      // 삼각형 1 (CCW from above = front face, normals UP)
      indices.push(tl, tr, bl);
      // 삼각형 2
      indices.push(tr, br, bl);
    }
  }

  // skirt: 4변에 아래로 내려가는 수직 geometry 추가 → LOD 전환 경계 틈 은폐
  // 깊이는 버텍스별 heightmap 주변 1픽셀 최대 높이 변화량으로 계산 → 틈 커버 + 지형 아래 노출 최소화
  const skirtEdges = [
    Array.from({ length: n }, (_, i) => i), // North (row=0)
    Array.from({ length: n }, (_, i) => (n - 1) * n + i), // South (row=n-1)
    Array.from({ length: n }, (_, i) => i * n), // West  (col=0)
    Array.from({ length: n }, (_, i) => i * n + (n - 1)), // East  (col=n-1)
  ];
  for (let edgeIdx = 0; edgeIdx < skirtEdges.length; edgeIdx++) {
    const edgeIndices = skirtEdges[edgeIdx];
    const reversed = edgeIdx === 1 || edgeIdx === 2; // South, West는 법선이 안쪽 → 역순 와인딩
    const skirtBase = positions.length / 3;
    for (let i = 0; i < edgeIndices.length; i++) {
      const vi = edgeIndices[i];
      const col = vi % n;
      const row = Math.floor(vi / n);
      const px = hmStartX + (col / cells) * hmTileSize;
      const py = hmStartY + (row / cells) * hmTileSize;
      const h = sampleHeight(hm, px, py);
      const depth = Math.max(
        Math.abs(sampleHeight(hm, px + 1, py) - h),
        Math.abs(sampleHeight(hm, px - 1, py) - h),
        Math.abs(sampleHeight(hm, px, py + 1) - h),
        Math.abs(sampleHeight(hm, px, py - 1) - h),
      ) + 2;
      positions.push(
        positions[vi * 3],
        positions[vi * 3 + 1] - depth,
        positions[vi * 3 + 2],
      );
      normals.push(normals[vi * 3], normals[vi * 3 + 1], normals[vi * 3 + 2]);
      uvs.push(uvs[vi * 2], uvs[vi * 2 + 1]);
    }
    for (let i = 0; i < n - 1; i++) {
      const topA = edgeIndices[i],
        topB = edgeIndices[i + 1];
      const botA = skirtBase + i,
        botB = skirtBase + i + 1;
      if (reversed) {
        indices.push(topA, botA, topB);
        indices.push(topB, botA, botB);
      } else {
        indices.push(topA, topB, botA);
        indices.push(topB, botB, botA);
      }
    }
  }

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.uvs = uvs;
  vertexData.normals = normals;

  const mesh = new Mesh(`tile_${tileKey(coord)}`, scene);
  vertexData.applyToMesh(mesh, false);
  mesh.isPickable = false;

  mesh.material = material;

  return mesh;
}
