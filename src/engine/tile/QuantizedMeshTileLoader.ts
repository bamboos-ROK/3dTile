import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import { Tile } from "./Tile";
import { getTileBounds } from "./TileCoords";
import { ParsedQuantizedMesh, parseQuantizedMesh } from "./QuantizedMeshParser";

const Z_COLORS: Color3[] = [
  Color3.Green(),
  Color3.Blue(),
  Color3.Yellow(),
  Color3.Magenta(),
  Color3.Red(),
];

/** z레벨당 1개 material 재사용 */
const materialCache = new Map<number, StandardMaterial>();

function getOrCreateMaterial(z: number, scene: Scene): StandardMaterial {
  if (!materialCache.has(z)) {
    const mat = new StandardMaterial(`terrain_mat_z${z}`, scene);
    mat.diffuseColor = Z_COLORS[z % Z_COLORS.length];
    materialCache.set(z, mat);
  }
  return materialCache.get(z)!;
}

// quantized-mesh 최소 단위(1/32767)의 절반 — 경계 삼각형 유지율 향상용
const BOUNDARY_EPS = 0.5 / 32767;

export class QuantizedMeshTileLoader {
  /**
   * @param baseUrl  로컬 지형 서버 주소 (예: "http://localhost:8080")
   * @param scene    Babylon.js Scene
   * @param heightScale  고도(meters) → world 좌표 변환 계수
   */
  constructor(
    private readonly baseUrl: string,
    private readonly scene: Scene,
    private readonly heightScale: number = 1.0,
  ) {}

  /** in-flight 요청 dedup: 형제 타일이 같은 parent를 동시에 요청해도 fetch 1회 */
  private readonly fetchCache = new Map<string, Promise<ArrayBuffer>>();

  /**
   * 타일 로더 콜백 — LODTraverser에 직접 전달 가능.
   * srcX/Y/Z: 실제 fetch할 타일 (부모 fallback 시 src ≠ target)
   * targetX/Y/Z: 렌더링할 타일 (mesh bounds 기준)
   */
  load = async (
    x: number,
    y: number,
    z: number,
    targetX = x,
    targetY = y,
    targetZ = z,
  ): Promise<Pick<Tile, "mesh">> => {
    const url = `${this.baseUrl}/terrain/${z}/${x}/${y}.terrain`;

    if (!this.fetchCache.has(url)) {
      this.fetchCache.set(
        url,
        fetch(url)
          .then((res) => {
            if (!res.ok)
              throw new Error(`Tile fetch failed [${res.status}]: ${z}/${x}/${y}`);
            return res.arrayBuffer();
          })
          .finally(() => this.fetchCache.delete(url)),
      );
    }

    const buffer = await this.fetchCache.get(url)!;
    const parsed = parseQuantizedMesh(buffer);
    const mesh = this.buildMeshForTarget(targetX, targetY, targetZ, x, y, z, parsed);
    return { mesh };
  };

  private buildMeshForTarget(
    targetX: number,
    targetY: number,
    targetZ: number,
    srcX: number,
    srcY: number,
    srcZ: number,
    parsed: ParsedQuantizedMesh,
  ): Mesh {
    const targetBounds = getTileBounds(targetX, targetY, targetZ);
    const n = targetZ - srcZ;       // 조상과의 레벨 차이 (n=0이면 동일 타일)
    const scale = 1 << n;           // 2^n
    const localX = targetX - (srcX << n);  // src u,v 공간에서 target의 오프셋
    const localY = targetY - (srcY << n);

    // epsilon으로 boundary vertex를 더 넓게 포함 → boundary 삼각형 유지율 향상
    const uMin = localX / scale - BOUNDARY_EPS;
    const uMax = (localX + 1) / scale + BOUNDARY_EPS;
    const vMin = localY / scale - BOUNDARY_EPS;
    const vMax = (localY + 1) / scale + BOUNDARY_EPS;

    const { u, v, height, indices, minHeight, maxHeight, vertexCount } = parsed;

    // 1. child bounds 안에 속하는 vertex 필터링 + 새 인덱스 매핑
    const newIdx = new Int32Array(vertexCount).fill(-1);
    let newCount = 0;
    for (let i = 0; i < vertexCount; i++) {
      if (u[i] >= uMin && u[i] <= uMax && v[i] >= vMin && v[i] <= vMax) {
        newIdx[i] = newCount++;
      }
    }

    if (newCount === 0) {
      throw new Error(
        `No geometry for ${targetZ}/${targetX}/${targetY} from src ${srcZ}/${srcX}/${srcY}`,
      );
    }

    // 2. positions 배열 (target bounds로 remapping)
    const positions = new Float32Array(newCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      if (newIdx[i] === -1) continue;
      const ni = newIdx[i];
      const uT = (u[i] - uMin) * scale;  // [0,1] target 공간
      const vT = (v[i] - vMin) * scale;
      positions[ni * 3] = targetBounds.minX + uT * targetBounds.size;
      positions[ni * 3 + 1] =
        (minHeight + height[i] * (maxHeight - minHeight)) * this.heightScale;
      positions[ni * 3 + 2] = targetBounds.minZ + vT * targetBounds.size;
    }

    // 3. 삼각형: 3 vertex 모두 in-bounds인 것만 유지
    const filteredIdx: number[] = [];
    for (let t = 0; t < indices.length; t += 3) {
      const a = newIdx[indices[t]];
      const b = newIdx[indices[t + 1]];
      const c = newIdx[indices[t + 2]];
      if (a >= 0 && b >= 0 && c >= 0) filteredIdx.push(a, b, c);
    }

    if (filteredIdx.length === 0) {
      throw new Error(`No triangles for ${targetZ}/${targetX}/${targetY}`);
    }

    const normals: number[] = [];
    VertexData.ComputeNormals(positions, filteredIdx, normals);

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = filteredIdx;
    vd.normals = normals;

    const mesh = new Mesh(`tile_${targetZ}/${targetX}/${targetY}`, this.scene);
    vd.applyToMesh(mesh, false);
    mesh.material = getOrCreateMaterial(targetZ, this.scene);
    return mesh;
  }
}
