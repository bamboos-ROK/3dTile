import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { TileCoord, CoarserBorders } from "./TerrainTile";
import { tileKey } from "./TerrainTile";
import { HEIGHT_SCALE, TERRAIN_SIZE, VERTEX_RESOLUTION } from "../constants";
import type { HeightmapData } from "../heightmap/HeightmapLoader";

/** heightmap 픽셀 좌표에서 높이값 샘플링 (bilinear interpolation), 0–1 반환 */
function sampleHeight(hm: HeightmapData, hmX: number, hmY: number): number {
  const floorX = Math.floor(hmX);
  const floorY = Math.floor(hmY);
  const x0 = Math.min(Math.max(floorX, 0), hm.width - 1);
  const y0 = Math.min(Math.max(floorY, 0), hm.height - 1);
  const x1 = Math.min(x0 + 1, hm.width - 1);
  const y1 = Math.min(y0 + 1, hm.height - 1);
  const fracX = hmX - floorX;
  const fracY = hmY - floorY;
  const h00 = hm.heights[y0 * hm.width + x0];
  const h10 = hm.heights[y0 * hm.width + x1];
  const h01 = hm.heights[y1 * hm.width + x0];
  const h11 = hm.heights[y1 * hm.width + x1];
  return h00 * (1 - fracX) * (1 - fracY) + h10 * fracX * (1 - fracY) + h01 * (1 - fracX) * fracY + h11 * fracX * fracY;
}

/** heightmap 픽셀 좌표에서 전역 법선 계산 (중앙차분법) */
function computeHeightmapNormal(
  hm: HeightmapData,
  hmX: number,
  hmY: number,
  pixelWorldSize: number,
): [number, number, number] {
  // 고정 world-space 거리(~2 units)로 샘플링 → 해상도 무관하게 동일한 법선 결과
  const normalStep = Math.max(1, Math.round(2.0 / pixelWorldSize));
  const heightLeft = sampleHeight(hm, hmX - normalStep, hmY);
  const heightRight = sampleHeight(hm, hmX + normalStep, hmY);
  const heightDown = sampleHeight(hm, hmX, hmY - normalStep);
  const heightUp = sampleHeight(hm, hmX, hmY + normalStep);
  const slopeX = (heightRight - heightLeft) * HEIGHT_SCALE / (2 * normalStep * pixelWorldSize);
  const slopeZ = (heightUp - heightDown) * HEIGHT_SCALE / (2 * normalStep * pixelWorldSize);
  const normalX = -slopeX,
    normalY = 1.0,
    normalZ = -slopeZ;
  const len = Math.sqrt(
    normalX * normalX + normalY * normalY + normalZ * normalZ,
  );
  return [normalX / len, normalY / len, normalZ / len];
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
  coarserBorders: CoarserBorders = { N: false, S: false, W: false, E: false },
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

  // T-junction 제거: 경계 정점 높이를 인접 coarse 타일 정점의 선형보간값으로 교체
  // step = 인접 부모 vertex까지의 heightmap 거리 (= childStep = hmTileSize / cells)
  const tjStep = hmTileSize / cells;
  const pixelWorldSize = TERRAIN_SIZE / hm.width;

  function eliminateTJunction(
    hmX: number,
    hmY: number,
    row: number,
    col: number,
  ): number {
    if (coord.level === 0) return sampleHeight(hm, hmX, hmY);
    // T-junction 제거는 이웃이 1레벨 더 거친(coarser) 방향의 border에만 적용한다.
    // 이웃이 같은 레벨이거나 더 세밀하면 이 타일이 "기준"이므로 raw 높이를 써야 한다.
    const onCoarserNS =
      (row === 0 && coarserBorders.N) || (row === cells && coarserBorders.S);
    const onCoarserWE =
      (col === 0 && coarserBorders.W) || (col === cells && coarserBorders.E);
    if (!onCoarserNS && !onCoarserWE) return sampleHeight(hm, hmX, hmY);
    const isTJ_col = onCoarserNS && (col + coord.tileX) % 2 !== 0;
    const isTJ_row = onCoarserWE && (row + coord.tileY) % 2 !== 0;
    if (isTJ_col && isTJ_row) {
      const interpolatedHeightX =
        (sampleHeight(hm, hmX - tjStep, hmY) +
          sampleHeight(hm, hmX + tjStep, hmY)) /
        2;
      const interpolatedHeightZ =
        (sampleHeight(hm, hmX, hmY - tjStep) +
          sampleHeight(hm, hmX, hmY + tjStep)) /
        2;
      return (interpolatedHeightX + interpolatedHeightZ) / 2;
    }
    if (isTJ_col)
      return (
        (sampleHeight(hm, hmX - tjStep, hmY) +
          sampleHeight(hm, hmX + tjStep, hmY)) /
        2
      );
    if (isTJ_row)
      return (
        (sampleHeight(hm, hmX, hmY - tjStep) +
          sampleHeight(hm, hmX, hmY + tjStep)) /
        2
      );
    return sampleHeight(hm, hmX, hmY);
  }

  // vertices 생성
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      // world 좌표
      const worldX = worldMinX + (col / cells) * worldTileSize;
      const worldZ = worldMinZ + (row / cells) * worldTileSize;

      // heightmap 픽셀 좌표
      const hmX = hmStartX + (col / cells) * hmTileSize;
      const hmY = hmStartY + (row / cells) * hmTileSize;
      const worldY = eliminateTJunction(hmX, hmY, row, col) * HEIGHT_SCALE;
      const [normalX, normalY, normalZ] = computeHeightmapNormal(
        hm,
        hmX,
        hmY,
        pixelWorldSize,
      );

      positions.push(worldX, worldY, worldZ);
      normals.push(normalX, normalY, normalZ);
      uvs.push(
        (worldZ + TERRAIN_SIZE / 2) / TERRAIN_SIZE,
        1.0 - (worldX + TERRAIN_SIZE / 2) / TERRAIN_SIZE,
      );
    }
  }

  // triangle indices (cell당 2개 삼각형)
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const topLeft = row * n + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + n;
      const bottomRight = bottomLeft + 1;
      // 삼각형 1 (CCW from above = front face, normals UP)
      indices.push(topLeft, topRight, bottomLeft);
      // 삼각형 2
      indices.push(topRight, bottomRight, bottomLeft);
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
