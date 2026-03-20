import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import "@babylonjs/inspector";

import { CameraController } from "./engine/camera/CameraController";
import { LocalGridTiling } from "./engine/tiling/LocalGridTiling";
import { LODSelector } from "./engine/lod/LODSelector";
import { TerrainTileManager } from "./engine/terrain/TerrainTileManager";
import { TerrainRenderer } from "./engine/renderer/TerrainRenderer";
import { loadHeightmap } from "./engine/heightmap/HeightmapLoader";
import { DebugCameraOverlay } from "./engine/debug/DebugCameraOverlay";

async function main() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new Engine(canvas, true);

  const scene = new Scene(engine);
  scene.clearColor.set(0.8, 0.5, 0.8, 1);

  // 조명
  const light = new HemisphericLight("ambLight", new Vector3(0, 100, 0), scene);
  light.intensity = 0.2;
  light.groundColor = new Color3(0.1, 0.08, 0.06);

  const directionalLight = new DirectionalLight(
    "dirLight",
    new Vector3(-1, -2, -1),
    scene,
  );
  directionalLight.intensity = 1.2;

  // 카메라
  const camera = new CameraController(scene, canvas);

  // Tiling + LOD
  const tiling = new LocalGridTiling();
  const lodSelector = new LODSelector();

  // Heightmap 로드
  const heightmap = await loadHeightmap("/heightmap.png");

  // 지형 머티리얼
  const terrainMat = new StandardMaterial("terrain", scene);
  terrainMat.diffuseTexture = new Texture("/Diffuse.exr", scene);
  terrainMat.specularColor = new Color3(0.1, 0.1, 0.1);
  terrainMat.specularPower = 32;

  // 타일 매니저 + 렌더러
  const tileManager = new TerrainTileManager(
    scene,
    tiling,
    heightmap,
    terrainMat,
  );
  const renderer = new TerrainRenderer(
    scene,
    tiling,
    lodSelector,
    tileManager,
    camera,
  );

  // Babylon Inspector 상시 활성화
  await scene.debugLayer.show({
    embedMode: true,
  });

  const debugOverlay = new DebugCameraOverlay(
    scene,
    canvas,
    camera,
    renderer,
    tileManager,
  );

  // 렌더 루프
  engine.runRenderLoop(() => {
    renderer.update();
    debugOverlay.update();
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
  window.addEventListener("beforeunload", () => {
    debugOverlay.dispose();
    camera.dispose();
    engine.dispose();
  });
}

main().catch(console.error);
