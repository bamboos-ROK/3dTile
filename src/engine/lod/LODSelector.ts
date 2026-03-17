import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TileBounds } from "../tiling/TilingScheme";
import { HEIGHT_SCALE } from "../constants";

/**
 * Screen-Space Error(SSE) 기반 LOD 레벨 선택
 *
 * screenError = (geometricError × projFactor) / depth
 * screenError < pixelThreshold → 현재 LOD로 충분 (세분화 불필요)
 *
 * projFactor = screenHeight / (2 × tan(fov / 2))
 * geometricError = bounds.size / 2  (타일 크기의 절반으로 근사)
 * depth = dot(tileCenter - cameraPos, cameraForward)  (시야 방향 투영 거리)
 */
export class LODSelector {
  private readonly pixelThreshold: number;

  constructor(pixelThreshold = 150) {
    this.pixelThreshold = pixelThreshold;
  }

  /**
   * 현재 타일의 level이 SSE 기준으로 충분한지 판단
   * true  → 이 타일을 그대로 렌더링
   * false → 자식 타일로 세분화 필요
   */
  isSufficientDetail(
    cameraPos: Vector3,
    bounds: TileBounds,
    projFactor: number,
    cameraForward: Vector3,
  ): boolean {
    const dx = bounds.centerX - cameraPos.x;
    const dy = HEIGHT_SCALE / 2 - cameraPos.y;
    const dz = bounds.centerZ - cameraPos.z;

    // 타일 중심까지의 depth (카메라 forward 방향 투영)
    const depth =
      dx * cameraForward.x + dy * cameraForward.y + dz * cameraForward.z;

    // 유클리드 거리: forward와 수직인 타일(발밑 등)의 depth ≈ 0 폭발 방지
    const euclidean = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const effectiveDepth = Math.max(depth, euclidean * 0.5);

    // 카메라 뒤 또는 near plane 이내: 세분화 불필요 (화면 영향 없음)
    if (effectiveDepth < 1.2) return true;

    const geometricError = bounds.size / 2;
    const screenError = (geometricError * projFactor) / effectiveDepth;
    return screenError < this.pixelThreshold;
  }
}
