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

  /** in-flight 요청 dedup: 같은 타일을 동시에 요청해도 fetch 1회 */
  private readonly fetchCache = new Map<string, Promise<ArrayBuffer>>();

  /** 타일 로더 콜백 — LODTraverser에 직접 전달 가능. */
  load = async (
    x: number,
    y: number,
    z: number,
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

    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3]     = bounds.minX + u[i] * bounds.size;
      positions[i * 3 + 1] = (minHeight + height[i] * (maxHeight - minHeight)) * this.heightScale;
      positions[i * 3 + 2] = bounds.minZ + v[i] * bounds.size;
    }

    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;

    const mesh = new Mesh(`tile_${z}/${x}/${y}`, this.scene);
    vd.applyToMesh(mesh, false);
    mesh.material = getOrCreateMaterial(z, this.scene);
    return mesh;
  }
}
