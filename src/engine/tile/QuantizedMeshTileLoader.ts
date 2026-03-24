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

  /**
   * 타일 로더 콜백 — LODTraverser에 직접 전달 가능.
   * 성공 시 { mesh } 반환, 실패 시 throw (→ 디버그 메시 폴백).
   */
  load = async (
    x: number,
    y: number,
    z: number,
  ): Promise<Pick<Tile, "mesh">> => {
    const url = `${this.baseUrl}/terrain/${z}/${x}/${y}.terrain`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tile fetch failed [${response.status}]: ${z}/${x}/${y}`);
    }
    const buffer = await response.arrayBuffer();
    const parsed = parseQuantizedMesh(buffer);
    const mesh = this.buildMesh(x, y, z, parsed);
    return { mesh };
  };

  private buildMesh(
    x: number,
    y: number,
    z: number,
    parsed: ParsedQuantizedMesh,
  ): Mesh {
    const bounds = getTileBounds(x, y, z);
    const { u, v, height, indices, minHeight, maxHeight, vertexCount } = parsed;
    const { heightScale } = this;

    // 좌표 매핑:
    //   u [0,1] → worldX = minX + u * size  (서→동)
    //   v [0,1] → worldZ = minZ + v * size  (남→북, TMS v=0=south)
    //   height [0,1] → worldY = (minH + h * (maxH - minH)) * heightScale
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = bounds.minX + u[i] * bounds.size;
      positions[i * 3 + 1] =
        (minHeight + height[i] * (maxHeight - minHeight)) * heightScale;
      positions[i * 3 + 2] = bounds.minZ + v[i] * bounds.size;
    }
    // Babylon.js IndicesArray: number[] | Int32Array | Uint32Array (Uint16Array 불가)
    const indicesArr =
      indices instanceof Uint32Array ? indices : new Uint32Array(indices);

    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indicesArr, normals);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indicesArr;
    vertexData.normals = normals;

    const mesh = new Mesh(`tile_${z}/${x}/${y}`, this.scene);
    vertexData.applyToMesh(mesh, false);
    mesh.material = getOrCreateMaterial(z, this.scene);
    return mesh;
  }
}
