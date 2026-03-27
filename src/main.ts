import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/inspector";

import { CameraController } from "./engine/camera/CameraController";
import { TileManager } from "./engine/tile/TileManager";
import { LODTraverser } from "./engine/tile/LODTraverser";
import { QuantizedMeshTileLoader } from "./engine/tile/QuantizedMeshTileLoader";
import {
  disposeDebugTileMesh,
  disposeDebugMaterialCache,
} from "./engine/tile/DebugTileMesh";

async function main() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new Engine(canvas, true);

  const scene = new Scene(engine);
  scene.clearColor.set(0.15, 0.15, 0.2, 1);

  // 조명
  const ambLight = new HemisphericLight(
    "ambLight",
    new Vector3(0, 1, 0),
    scene,
  );
  ambLight.intensity = 0.4;
  ambLight.groundColor = new Color3(0.1, 0.08, 0.06);

  const dirLight = new DirectionalLight(
    "dirLight",
    new Vector3(-1, -2, -1),
    scene,
  );
  dirLight.intensity = 0.8;

  // 카메라
  const camera = new CameraController(scene, canvas);
  const debugCamera = new CameraController(scene, canvas, true, "debugCamera");
  debugCamera.camera.detachControl();

  // TileManager + LODTraverser
  const tileManager = new TileManager(() => camera.camera.position);
  const BASE_URL = "http://192.168.0.201:28845";
  const SAT_BASE_URL = "http://192.168.0.201:28845";
  const tileLoader = new QuantizedMeshTileLoader(
    BASE_URL,
    scene,
    0.01,
    SAT_BASE_URL,
  );
  const traverser = new LODTraverser(tileManager, scene, tileLoader.load);

  // Babylon Inspector 활성화
  await scene.debugLayer.show({ embedMode: true });

  // 렌더 루프 — 매 프레임 LOD 순회
  engine.runRenderLoop(() => {
    traverser.update(camera.camera);
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
  window.addEventListener("beforeunload", () => {
    tileManager.getAllTiles().forEach((tile) => disposeDebugTileMesh(tile));
    disposeDebugMaterialCache();
    camera.dispose();
    debugCamera.dispose();
    engine.dispose();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyF") {
      if (scene.activeCamera === camera.camera) {
        camera.camera.detachControl();
        debugCamera.camera.attachControl(canvas, true);
        scene.activeCamera = debugCamera.camera;
      } else {
        debugCamera.camera.detachControl();
        camera.camera.attachControl(canvas, true);
        scene.activeCamera = camera.camera;
      }
    }
  });
}

main().catch(console.error);
