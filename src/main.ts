import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/inspector';

import { CameraController } from './engine/camera/CameraController';
import { LocalGridTiling } from './engine/tiling/LocalGridTiling';
import { LODSelector } from './engine/lod/LODSelector';
import { TerrainTileManager } from './engine/terrain/TerrainTileManager';
import { TerrainRenderer } from './engine/renderer/TerrainRenderer';
import { loadHeightmap } from './engine/terrain/TerrainMeshBuilder';

async function main() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const engine = new Engine(canvas, true);

  const scene = new Scene(engine);
  scene.clearColor.set(0.1, 0.1, 0.15, 1);

  // 조명
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
  light.intensity = 0.2;
  light.groundColor = new Color3(0.1, 0.08, 0.06);

  const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, -1), scene);
  dirLight.intensity = 1.2;

  // 카메라
  const camera = new CameraController(scene, canvas);

  // Tiling + LOD
  const tiling = new LocalGridTiling(4, 512);
  const lodSelector = new LODSelector(4);

  // Heightmap 로드
  const heightmap = await loadHeightmap('/heightmap.png');
  console.log(`[Main] Heightmap loaded: ${heightmap.width}×${heightmap.height}`);

  // 타일 매니저 + 렌더러
  const tileManager = new TerrainTileManager(scene, tiling, heightmap);
  const renderer = new TerrainRenderer(scene, tiling, lodSelector, tileManager, camera);

  // Babylon Inspector 상시 활성화
  await scene.debugLayer.show({
    embedMode: true,
  });

  // 렌더 루프
  engine.runRenderLoop(() => {
    renderer.update();
    scene.render();
  });

  window.addEventListener('resize', () => engine.resize());
}

main().catch(console.error);
