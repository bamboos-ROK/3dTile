import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";

export class CameraController {
  readonly camera: UniversalCamera;
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly keysDown = new Set<string>();
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private readonly keyupHandler: (e: KeyboardEvent) => void;
  private readonly wheelHandler: (e: WheelEvent) => void;
  private readonly renderObserver: Observer<Scene>;

  private static readonly MOVE_SPEED = 80; // units/sec
  private static readonly MIN_HEIGHT = 20;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;

    this.camera = new UniversalCamera(
      "mainCamera",
      new Vector3(-100, 800, 300),
      scene,
    );
    this.camera.setTarget(new Vector3(0, 0, 0));
    this.camera.attachControl(canvas, true);

    // 기본 키보드 이동 제거 (마우스 회전은 유지)
    this.camera.inputs.removeByType("FreeCameraKeyboardMoveInput");

    // 키 상태 추적
    this.keydownHandler = (e: KeyboardEvent) => this.keysDown.add(e.code);
    this.keyupHandler = (e: KeyboardEvent) => this.keysDown.delete(e.code);
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);

    // 마우스 휠: Y 고도 조절
    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const nextY = this.camera.position.y + delta;
      if (nextY >= CameraController.MIN_HEIGHT) {
        this.camera.position.y = nextY;
      }
    };
    canvas.addEventListener("wheel", this.wheelHandler, { passive: false });

    // 매 프레임: XZ 수평 이동
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      this.updateMovement();
    });
  }

  private updateMovement(): void {
    const fwd =
      this.keysDown.has("KeyW") || this.keysDown.has("ArrowUp") ? 1 : 0;
    const bwd =
      this.keysDown.has("KeyS") || this.keysDown.has("ArrowDown") ? 1 : 0;
    const rgt =
      this.keysDown.has("KeyD") || this.keysDown.has("ArrowRight") ? 1 : 0;
    const lft =
      this.keysDown.has("KeyA") || this.keysDown.has("ArrowLeft") ? 1 : 0;

    const forwardInput = fwd - bwd;
    const rightInput = rgt - lft;
    if (forwardInput === 0 && rightInput === 0) return;

    const dt = this.scene.getEngine().getDeltaTime() / 1000;

    // 카메라 전방 벡터를 XZ 평면에 투영
    const dir = this.camera.target.subtract(this.camera.position);
    dir.y = 0;
    if (dir.lengthSquared() < 1e-6) return;
    const forward = Vector3.Normalize(dir);

    const right = Vector3.Normalize(Vector3.Cross(Vector3.Up(), forward));

    const move = forward
      .scale(forwardInput * CameraController.MOVE_SPEED * dt)
      .addInPlace(right.scale(rightInput * CameraController.MOVE_SPEED * dt));

    this.camera.position.addInPlace(move);
    this.camera.target.addInPlace(move);
  }

  get position(): Vector3 {
    return this.camera.position;
  }

  get target(): Vector3 {
    return this.camera.target;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.renderObserver);
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("keyup", this.keyupHandler);
    this.canvas.removeEventListener("wheel", this.wheelHandler);
  }
}
