import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

export class CameraController {
  readonly camera: UniversalCamera;
  private readonly wheelHandler: (e: WheelEvent) => void;
  private readonly canvas: HTMLCanvasElement;

  private static readonly ZOOM_SPEED = 1.0;
  private static readonly MIN_HEIGHT = 20;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new UniversalCamera(
      "mainCamera",
      new Vector3(-100, 800, 300),
      scene,
    );
    this.camera.setTarget(new Vector3(0, 0, 0));
    this.camera.attachControl(canvas, true);
    this.camera.speed = 5;

    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * CameraController.ZOOM_SPEED;
      const nextY = this.camera.position.y + delta;
      if (nextY >= CameraController.MIN_HEIGHT) {
        this.camera.position.y = nextY;
      }
    };
    canvas.addEventListener("wheel", this.wheelHandler, { passive: false });
  }

  get position(): Vector3 {
    return this.camera.position;
  }

  dispose(): void {
    this.canvas.removeEventListener("wheel", this.wheelHandler);
  }
}
