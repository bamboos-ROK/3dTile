import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TileBounds } from "../tiling/TilingScheme";
import { HEIGHT_SCALE } from "../constants";

/**
 * Screen-Space Error(SSE) 기반 LOD 레벨 선택
 *
 * screenError = (geometricError × projFactor) / distance
 * screenError < pixelThreshold → 현재 LOD로 충분 (세분화 불필요)
 *
 * projFactor = screenHeight / (2 × tan(fov / 2))
 * geometricError = bounds.size / 2  (타일 크기의 절반으로 근사)
 */
export class LODSelector {
  private readonly pixelThreshold: number;

  constructor(pixelThreshold = 200) {
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
  ): boolean {
    const clampedX = Math.max(bounds.minX, Math.min(cameraPos.x, bounds.maxX));
    const clampedZ = Math.max(bounds.minZ, Math.min(cameraPos.z, bounds.maxZ));
    const clampedY = Math.max(0, Math.min(cameraPos.y, HEIGHT_SCALE));
    const dx = cameraPos.x - clampedX;
    const dz = cameraPos.z - clampedZ;
    const dy = cameraPos.y - clampedY;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 카메라가 타일 AABB 내부: 항상 세분화
    if (distance < 1e-6) return false;

    const geometricError = bounds.size / 2;
    const screenError = (geometricError * projFactor) / distance;
    return screenError < this.pixelThreshold;
  }
}
