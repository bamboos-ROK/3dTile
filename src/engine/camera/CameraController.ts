import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";

export class CameraController {
  readonly camera: ArcRotateCamera;
  private readonly scene: Scene;
  private readonly keysDown = new Set<string>();
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private readonly keyupHandler: (e: KeyboardEvent) => void;
  private readonly renderObserver: Observer<Scene>;

  private static readonly MOVE_SPEED = 80; // units/sec

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;

    this.camera = new ArcRotateCamera(
      "mainCamera",
      Math.PI * 0.8,
      Math.PI * 0.2,
      750,
      Vector3.Zero(),
      scene,
    );
    this.camera.attachControl(canvas, true);

    // 키보드 이동 입력 제거 (W/S/A/D는 직접 처리)
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

    // 카메라 제한값
    this.camera.lowerBetaLimit = Math.PI / 8; // 22.5° — 정수직 하향 방지
    this.camera.upperBetaLimit = Math.PI / 2 - 0.05; // ~87°  — 지평선 진입 방지
    this.camera.lowerRadiusLimit = 50;
    this.camera.upperRadiusLimit = 2000;

    // 키 상태 추적
    this.keydownHandler = (e: KeyboardEvent) => this.keysDown.add(e.code);
    this.keyupHandler = (e: KeyboardEvent) => this.keysDown.delete(e.code);
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);

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

    const dt = Math.min(this.scene.getEngine().getDeltaTime(), 33) / 1000;
    const alpha = this.camera.alpha;

    // alpha에서 XZ forward 직접 계산 (이미 단위벡터)
    const forward = new Vector3(-Math.cos(alpha), 0, -Math.sin(alpha));
    // Cross(Up, forward): facing +Z → right = +X (올바른 방향)
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();

    const move = forward
      .scale(forwardInput * CameraController.MOVE_SPEED * dt)
      .addInPlace(right.scale(rightInput * CameraController.MOVE_SPEED * dt));

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
    this.camera.detachControl();
  }
}
