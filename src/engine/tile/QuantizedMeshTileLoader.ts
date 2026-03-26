import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

import { Tile } from "./Tile";
import { getTileBounds } from "./TileCoords";
import { ParsedQuantizedMesh, parseQuantizedMesh } from "./QuantizedMeshParser";
import { SatelliteTextureBuilder } from "./SatelliteTextureBuilder";

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
   * @param satBaseUrl   위성 이미지 서버 주소 (없으면 solid color fallback)
   */
  constructor(
    private readonly baseUrl: string,
    private readonly scene: Scene,
    private readonly heightScale: number = 1.0,
    satBaseUrl?: string,
  ) {
    if (satBaseUrl) {
      this.textureBuilder = new SatelliteTextureBuilder(scene, satBaseUrl);
    }
  }

  private readonly textureBuilder?: SatelliteTextureBuilder;

  /** tile 단위 generation — dispose 후 재생성 시 stale texture 차단 */
  private readonly _tileGen = new Map<string, number>();

  /** in-flight 요청 dedup: 같은 타일을 동시에 요청해도 fetch 1회 */
  private readonly fetchCache = new Map<string, Promise<ArrayBuffer>>();

  /** 타일 로더 콜백 — LODTraverser에 직접 전달 가능. */
  load = async (
    x: number,
    y: number,
    z: number,
  ): Promise<Pick<Tile, "mesh" | "onDispose">> => {
    const url = `${this.baseUrl}/terrain/${z}/${x}/${y}.terrain`;

    if (!this.fetchCache.has(url)) {
      this.fetchCache.set(
        url,
        fetch(url)
          .then((res) => {
            if (!res.ok)
              throw new Error(
                `Tile fetch failed [${res.status}]: ${z}/${x}/${y}`,
              );
            return res.arrayBuffer();
          })
          .finally(() => this.fetchCache.delete(url)),
      );
    }

    const buffer = await this.fetchCache.get(url)!;
    const parsed = parseQuantizedMesh(buffer);
    const mesh = this.buildMesh(x, y, z, parsed);

    if (!this.textureBuilder) {
      return { mesh };
    }

    // 즉시 fallback 표시 (satellite 로딩 중에도 지형 보임)
    let satMaterial: StandardMaterial | null = null;

    // tile 단위 generation — 동일 tile 재생성 시 이전 lifecycle의 stale texture 차단
    const tileKey = `${z}/${x}/${y}`;
    this._tileGen.set(tileKey, (this._tileGen.get(tileKey) ?? 0) + 1);
    const myGen = this._tileGen.get(tileKey)!;

    const applyTexture = (tex: DynamicTexture) => {
      if (mesh.isDisposed() || myGen !== this._tileGen.get(tileKey)) {
        tex.dispose();
        return;
      }
      const oldTex = satMaterial?.diffuseTexture as DynamicTexture | null;
      if (!satMaterial) {
        const mat = new StandardMaterial(`sat_mat_${tileKey}`, this.scene);
        mat.specularColor = Color3.Black();
        mesh.material = mat;
        satMaterial = mat;
      }
      satMaterial.diffuseTexture = tex;
      oldTex?.dispose();
    };

    this.textureBuilder.buildCompositeTexture(x, y, z, applyTexture)
      .then((finalTex) => { if (finalTex) applyTexture(finalTex); });

    const onDispose = () => {
      (satMaterial?.diffuseTexture as DynamicTexture | null)?.dispose();
      satMaterial?.dispose();
      satMaterial = null;
      this.textureBuilder!.cancelComposite(x, y, z);
    };

    return { mesh, onDispose };
  };

  private buildMesh(
    x: number,
    y: number,
    z: number,
    parsed: ParsedQuantizedMesh,
  ): Mesh {
    const bounds = getTileBounds(x, y, z);
    const { u, v, height, indices, minHeight, maxHeight, vertexCount } = parsed;

    // 메인 positions 빌드
    const mainPositions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      mainPositions[i * 3] = bounds.minX + u[i] * bounds.size;
      mainPositions[i * 3 + 1] =
        (minHeight + height[i] * (maxHeight - minHeight)) * this.heightScale;
      mainPositions[i * 3 + 2] = bounds.minZ + v[i] * bounds.size;
    }

    // 메인 UV 빌드
    // - u[i]: west=0, east=1 → UV U와 일치
    // - v[i]: south=0, north=1 → Babylon.js V=0=하단, V=1=상단과 일치
    // - OffscreenCanvas Y=0=north는 WebGL 텍스처 로딩 시 자동 플립되어 상쇄
    const mainUVs = new Float32Array(vertexCount * 2);
    for (let i = 0; i < vertexCount; i++) {
      mainUVs[i * 2] = u[i];
      mainUVs[i * 2 + 1] = v[i];
    }

    // Skirt geometry — LOD 경계 seam을 아래로 드리우는 "치마"로 가림
    const EDGE_EPS = 2 / 32767;
    const skirtDepth = Math.max(
      (maxHeight - minHeight) * this.heightScale * 0.3,
      this.heightScale * 0.1,
      bounds.size * 0.05,
    );

    // 4방향 엣지 vertex 수집 (정렬키 포함)
    type EdgeVert = { idx: number; sort: number };
    const west: EdgeVert[] = [];
    const east: EdgeVert[] = [];
    const south: EdgeVert[] = [];
    const north: EdgeVert[] = [];

    for (let i = 0; i < vertexCount; i++) {
      if (u[i] < EDGE_EPS) west.push({ idx: i, sort: v[i] });
      if (u[i] > 1 - EDGE_EPS) east.push({ idx: i, sort: v[i] });
      if (v[i] < EDGE_EPS) south.push({ idx: i, sort: u[i] });
      if (v[i] > 1 - EDGE_EPS) north.push({ idx: i, sort: u[i] });
    }

    west.sort((a, b) => a.sort - b.sort);
    east.sort((a, b) => a.sort - b.sort);
    south.sort((a, b) => a.sort - b.sort);
    north.sort((a, b) => a.sort - b.sort);

    // skirt vertex 배열 (원본 vertex 뒤에 append)
    const skirtVerts: number[] = [];
    const skirtUVs: number[] = [];
    // skirt vertex의 원본 내 인덱스 → skirt 배열 내 위치 매핑
    const skirtMap = new Map<number, number>(); // origIdx → skirtOffset

    function addSkirtVertex(origIdx: number): number {
      if (skirtMap.has(origIdx)) return skirtMap.get(origIdx)!;
      const offset = skirtVerts.length / 3;
      skirtVerts.push(
        mainPositions[origIdx * 3],
        mainPositions[origIdx * 3 + 1] - skirtDepth,
        mainPositions[origIdx * 3 + 2],
      );
      skirtUVs.push(mainUVs[origIdx * 2], mainUVs[origIdx * 2 + 1]);
      skirtMap.set(origIdx, offset);
      return offset;
    }

    // skirt 인덱스 (vertexCount + skirtOffset 으로 참조)
    const skirtIndices: number[] = [];

    // 4방향 엣지마다 연속 쌍 → quad(tri×2)
    // WebGL CCW = front face. Babylon.js left-handed: camera_right = up × forward
    //   flip=false: camera right = -축 → a=RIGHT, b=LEFT → (a,b,sb) CCW ✓  (North, West)
    //   flip=true:  camera right = +축 → a=LEFT,  b=RIGHT → (a,b,sb) CW  → 반전   (South, East)
    function addSkirtQuad(a: number, b: number, flip: boolean) {
      const sa = vertexCount + addSkirtVertex(a);
      const sb = vertexCount + addSkirtVertex(b);
      if (flip) {
        skirtIndices.push(a, sa, sb, a, sb, b);
      } else {
        skirtIndices.push(a, b, sb, a, sb, sa);
      }
    }

    function addEdgeSkirts(edge: EdgeVert[], flip: boolean) {
      for (let i = 0; i + 1 < edge.length; i++) {
        addSkirtQuad(edge[i].idx, edge[i + 1].idx, flip);
      }
    }

    addEdgeSkirts(north, false);
    addEdgeSkirts(south, true);
    addEdgeSkirts(west, false);
    addEdgeSkirts(east, true);

    // 최종 positions / indices / UVs 합산
    const totalVertices = vertexCount + skirtVerts.length / 3;
    const allPositions = new Float32Array(totalVertices * 3);
    allPositions.set(mainPositions, 0);
    allPositions.set(skirtVerts, vertexCount * 3);

    const allUVs = new Float32Array(totalVertices * 2);
    allUVs.set(mainUVs, 0);
    allUVs.set(skirtUVs, vertexCount * 2);

    const mainIndexCount = indices.length;
    const allIndices = new (totalVertices > 65535 ? Uint32Array : Uint16Array)(
      mainIndexCount + skirtIndices.length,
    );
    allIndices.set(indices, 0);
    allIndices.set(skirtIndices, mainIndexCount);

    // terrain 법선: main geometry만으로 계산 — skirt 삼각형이 경계 vertex 법선을 왜곡하지 않도록
    const mainNormals: number[] = [];
    VertexData.ComputeNormals(mainPositions, indices, mainNormals);

    // skirt 법선: (0,-1,0) 고정 — terrain과 독립, 조명 영향 최소화 (seam 은폐 목적)
    const skirtVertCount = skirtVerts.length / 3;
    const skirtNormals = new Float32Array(skirtVertCount * 3);
    for (let i = 0; i < skirtVertCount; i++) {
      skirtNormals[i * 3 + 1] = -1;
    }

    const normals = new Float32Array(totalVertices * 3);
    normals.set(mainNormals, 0);
    normals.set(skirtNormals, vertexCount * 3);

    const vd = new VertexData();
    vd.positions = allPositions;
    vd.indices = allIndices;
    vd.normals = normals;
    vd.uvs = allUVs;

    const mesh = new Mesh(`tile_${z}/${x}/${y}`, this.scene);
    vd.applyToMesh(mesh, false);
    mesh.material = getOrCreateMaterial(z, this.scene);
    return mesh;
  }
}
