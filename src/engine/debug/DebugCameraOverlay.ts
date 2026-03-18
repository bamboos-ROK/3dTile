import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Material } from "@babylonjs/core/Materials/material";
import { parseTileKey } from "../terrain/TerrainTile";
import type { CameraController } from "../camera/CameraController";
import type { TerrainRenderer } from "../renderer/TerrainRenderer";
import type { TerrainTileManager } from "../terrain/TerrainTileManager";

const LOD_COLORS: readonly Color3[] = [
  new Color3(0.2, 0.4, 1.0), // Level 0: 파란색 (가장 거침)
  new Color3(0.2, 0.8, 0.2), // Level 1: 초록색
  new Color3(1.0, 1.0, 0.2), // Level 2: 노란색
  new Color3(1.0, 0.5, 0.1), // Level 3: 주황색
  new Color3(1.0, 0.2, 0.2), // Level 4: 빨간색 (가장 세밀)
];

export class DebugCameraOverlay {
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly mainCamera: CameraController;
  private readonly renderer: TerrainRenderer;
  private readonly tileManager: TerrainTileManager;

  private readonly debugCamera: ArcRotateCamera;
  private readonly lodMaterials = new Map<number, StandardMaterial>();
  private readonly originalMaterials = new Map<string, Material | null>();

  private isDebugOn = false;
  private readonly keydownHandler: (e: KeyboardEvent) => void;

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    mainCamera: CameraController,
    renderer: TerrainRenderer,
    tileManager: TerrainTileManager,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.mainCamera = mainCamera;
    this.renderer = renderer;
    this.tileManager = tileManager;

    this.debugCamera = new ArcRotateCamera(
      "debugCamera",
      Math.PI * 0.3,
      Math.PI * 0.4,
      2000,
      Vector3.Zero(),
      scene,
    );
    this.debugCamera.lowerRadiusLimit = 200;
    this.debugCamera.upperRadiusLimit = 3000;
    this.debugCamera.lowerBetaLimit = Math.PI / 8;
    this.debugCamera.upperBetaLimit = Math.PI / 2 - 0.05;

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyF") this.toggle();
    };
    window.addEventListener("keydown", this.keydownHandler);
  }

  toggle(): void {
    this.isDebugOn = !this.isDebugOn;
    if (this.isDebugOn) {
      this.mainCamera.camera.detachControl();
      this.scene.activeCamera = this.debugCamera;
      this.debugCamera.attachControl(this.canvas, true);
    } else {
      this.debugCamera.detachControl();
      this.scene.activeCamera = this.mainCamera.camera;
      this.mainCamera.camera.attachControl(this.canvas, true);
      this.mainCamera.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
      this.restoreAllMaterials();
    }
  }

  update(): void {
    if (!this.isDebugOn) return;
    this.applyLodColors();
  }

  private applyLodColors(): void {
    const visibleKeys = this.renderer.visibleTileKeys;

    // dispose된 타일 정리
    for (const key of this.originalMaterials.keys()) {
      if (!visibleKeys.has(key)) {
        this.originalMaterials.delete(key);
      }
    }

    for (const key of visibleKeys) {
      const tile = this.tileManager.getTile(key);
      if (!tile?.mesh) continue;

      // 원본 material은 처음 한 번만 저장
      if (!this.originalMaterials.has(key)) {
        this.originalMaterials.set(key, tile.mesh.material);
      }
      // 매 프레임 적용 — 타일 재생성 시에도 자동으로 LOD 색상 유지
      tile.mesh.material = this.getLodMaterial(parseTileKey(key).level);
    }
  }

  private getLodMaterial(level: number): StandardMaterial {
    if (!this.lodMaterials.has(level)) {
      const mat = new StandardMaterial(`debugLod${level}`, this.scene);
      mat.diffuseColor = LOD_COLORS[level] ?? new Color3(1, 1, 1);
      mat.emissiveColor = (LOD_COLORS[level] ?? new Color3(1, 1, 1)).scale(0.3);
      this.lodMaterials.set(level, mat);
    }
    return this.lodMaterials.get(level)!;
  }

  private restoreAllMaterials(): void {
    for (const [key, origMat] of this.originalMaterials) {
      const tile = this.tileManager.getTile(key);
      if (tile?.mesh) tile.mesh.material = origMat;
    }
    this.originalMaterials.clear();
  }

  dispose(): void {
    if (this.isDebugOn) this.restoreAllMaterials();
    this.debugCamera.dispose();
    this.lodMaterials.forEach((m) => m.dispose());
    window.removeEventListener("keydown", this.keydownHandler);
  }
}
