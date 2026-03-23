import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { Tile } from "./Tile";
import { TileBounds } from "./TileCoords";

/** z-fighting 방지용 미세 y offset (시각적으로는 동일 평면) */
const EPSILON = 0.001;

/** z 레벨별 색상 (범위 초과 시 modulo 순환) */
const Z_COLORS: Color3[] = [
  Color3.Green(),
  Color3.Blue(),
  Color3.Yellow(),
  Color3.Magenta(),
  Color3.Red(),
];

function getZColor(z: number): Color3 {
  return Z_COLORS[z % Z_COLORS.length];
}

/** z레벨당 1개 material 재사용 */
const materialCache = new Map<number, StandardMaterial>();

function getOrCreateMaterial(z: number, scene: Scene): StandardMaterial {
  if (!materialCache.has(z)) {
    const mat = new StandardMaterial(`debug_mat_z${z}`, scene);
    mat.diffuseColor = getZColor(z);
    mat.alpha = 0.5;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    materialCache.set(z, mat);
  }
  return materialCache.get(z)!;
}

/**
 * 타일 bounds 기반 반투명 ground plane 생성.
 * 동일 평면(y≈0)에 배치하며 z레벨 색상으로 LOD를 구분한다.
 */
export function createDebugTileMesh(
  tile: Tile,
  bounds: TileBounds,
  scene: Scene,
): Mesh {
  const mesh = MeshBuilder.CreateGround(
    `debug_${tile.z}/${tile.x}/${tile.y}`,
    { width: bounds.size, height: bounds.size },
    scene,
  );

  mesh.position = new Vector3(bounds.centerX, EPSILON * tile.z, bounds.centerZ);

  mesh.material = getOrCreateMaterial(tile.z, scene);

  return mesh;
}

export function disposeDebugTileMesh(tile: Tile): void {
  tile.mesh?.dispose();
  tile.mesh = undefined;
}

export function disposeDebugMaterialCache(): void {
  materialCache.forEach((mat) => mat.dispose());
  materialCache.clear();
}
