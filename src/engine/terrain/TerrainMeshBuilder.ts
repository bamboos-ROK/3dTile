import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { TileCoord, CoarserBorders } from "./TerrainTile";
import { tileKey } from "./TerrainTile";
import { HEIGHT_SCALE, TERRAIN_SIZE, VERTEX_RESOLUTION } from "../constants";
import type { HeightmapData } from "../heightmap/HeightmapLoader";

/** heightmap 픽셀 좌표에서 높이값 샘플링 (0~HEIGHT_SCALE) */
function sampleHeight(hm: HeightmapData, hmX: number, hmY: number): number {
  const x = Math.min(Math.max(Math.floor(hmX), 0), hm.width - 1);
  const y = Math.min(Math.max(Math.floor(hmY), 0), hm.height - 1);
  const idx = (y * hm.width + x) * 4; // RGBA
  return (hm.pixels[idx] / 255) * HEIGHT_SCALE;
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
  const heightLeft  = sampleHeight(hm, hmX - normalStep, hmY);
  const heightRight = sampleHeight(hm, hmX + normalStep, hmY);
  const heightDown  = sampleHeight(hm, hmX, hmY - normalStep);
  const heightUp    = sampleHeight(hm, hmX, hmY + normalStep);
  const slopeX = (heightRight - heightLeft) / (2 * normalStep * pixelWorldSize);
  const slopeZ = (heightUp    - heightDown) / (2 * normalStep * pixelWorldSize);
  const normalX = -slopeX,
    normalY = 1.0,
    normalZ = -slopeZ;
  const len = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
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

  // BVS: border T-junction vertex 높이를 부모 타일 선형보간값으로 snap
  // step = 인접 부모 vertex까지의 heightmap 거리 (= childStep = hmTileSize / cells)
  const bvsStep = hmTileSize / cells;
  const pixelWorldSize = TERRAIN_SIZE / hm.width;

  function borderSnapHeight(hmX: number, hmY: number, row: number, col: number): number {
    if (coord.level === 0) return sampleHeight(hm, hmX, hmY);
    // BVS는 이웃이 1레벨 더 거친(coarser) 방향의 border에만 적용한다.
    // 이웃이 같은 레벨이거나 더 세밀하면 이 타일이 "기준"이므로 raw 높이를 써야 한다.
    const onCoarserNS =
      (row === 0 && coarserBorders.N) || (row === cells && coarserBorders.S);
    const onCoarserWE =
      (col === 0 && coarserBorders.W) || (col === cells && coarserBorders.E);
    if (!onCoarserNS && !onCoarserWE) return sampleHeight(hm, hmX, hmY);
    const isTJ_col = onCoarserNS && (col + coord.tileX) % 2 !== 0;
    const isTJ_row = onCoarserWE && (row + coord.tileY) % 2 !== 0;
    if (isTJ_col && isTJ_row) {
      const hX = (sampleHeight(hm, hmX - bvsStep, hmY) + sampleHeight(hm, hmX + bvsStep, hmY)) / 2;
      const hZ = (sampleHeight(hm, hmX, hmY - bvsStep) + sampleHeight(hm, hmX, hmY + bvsStep)) / 2;
      return (hX + hZ) / 2;
    }
    if (isTJ_col) return (sampleHeight(hm, hmX - bvsStep, hmY) + sampleHeight(hm, hmX + bvsStep, hmY)) / 2;
    if (isTJ_row) return (sampleHeight(hm, hmX, hmY - bvsStep) + sampleHeight(hm, hmX, hmY + bvsStep)) / 2;
    return sampleHeight(hm, hmX, hmY);
  }

  // vertices 생성
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      // world 좌표
      const wx = worldMinX + (col / cells) * worldTileSize;
      const wz = worldMinZ + (row / cells) * worldTileSize;

      // heightmap 픽셀 좌표
      const hmX = hmStartX + (col / cells) * hmTileSize;
      const hmY = hmStartY + (row / cells) * hmTileSize;
      const wy = borderSnapHeight(hmX, hmY, row, col);
      const [normalX, normalY, normalZ] = computeHeightmapNormal(hm, hmX, hmY, pixelWorldSize);

      positions.push(wx, wy, wz);
      normals.push(normalX, normalY, normalZ);
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
      const hmX = hmStartX + (col / cells) * hmTileSize;
      const hmY = hmStartY + (row / cells) * hmTileSize;
      const h = positions[vi * 3 + 1]; // BVS-snapped 높이
      const r = Math.max(bvsStep / 2, 1); // halfSpacing: 2+ level 차이 안전망
      const depth = Math.max(
        Math.abs(sampleHeight(hm, hmX + r, hmY) - h),
        Math.abs(sampleHeight(hm, hmX - r, hmY) - h),
        Math.abs(sampleHeight(hm, hmX, hmY + r) - h),
        Math.abs(sampleHeight(hm, hmX, hmY - r) - h),
      ) + 2; // +2: 부동소수점 오차와 수직 절벽에서 skirt가 짧아질 경우를 대비한 최소 여유값
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
