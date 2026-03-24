import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";

export class CameraController {
  readonly camera: ArcRotateCamera;
  private readonly scene: Scene;
  private readonly debug: boolean;
  private readonly keysDown = new Set<string>();
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private readonly keyupHandler: (e: KeyboardEvent) => void;
  private readonly renderObserver: Observer<Scene>;

  private static readonly MOVE_SPEED = 200; // units/sec

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    debug = false,
    name: string = "mainCamera",
  ) {
    this.scene = scene;
    this.debug = debug;
    const initialTarget = new Vector3(0, 0, 0);
    this.camera = new ArcRotateCamera(
      name,
      Math.PI * 1.7,
      Math.PI * 0.3,
      800,
      initialTarget,
      scene,
    );
    this.camera.attachControl(canvas, true);

    // 키보드 이동 입력 제거 (W/S/A/D는 직접 처리)
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

    // 카메라 제한값
    this.camera.lowerBetaLimit = 0; // 22.5° — 정수직 하향 방지
    this.camera.upperBetaLimit = Math.PI / 2 - 0.05; // ~87°  — 지평선 진입 방지
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 5000;
    this.camera.wheelPrecision = 2;

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
    const forwardKey = this.debug ? "KeyW" : "ArrowUp";
    const backKey = this.debug ? "KeyS" : "ArrowDown";
    const rightKey = this.debug ? "KeyD" : "ArrowRight";
    const leftKey = this.debug ? "KeyA" : "ArrowLeft";

    const fwd = this.keysDown.has(forwardKey) ? 1 : 0;
    const bwd = this.keysDown.has(backKey) ? 1 : 0;
    const rgt = this.keysDown.has(rightKey) ? 1 : 0;
    const lft = this.keysDown.has(leftKey) ? 1 : 0;

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
