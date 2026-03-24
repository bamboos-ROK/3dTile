/**
 * Cesium quantized-mesh 1.0 바이너리 포맷 파서
 *
 * 포맷 구조:
 *   Header (88 bytes)
 *   vertexCount (u32)
 *   u[vertexCount] (u16, zig-zag delta encoded)
 *   v[vertexCount] (u16, zig-zag delta encoded)
 *   height[vertexCount] (u16, zig-zag delta encoded)
 *   [4-byte 정렬 패딩]
 *   triangleCount (u32)
 *   indices[triangleCount * 3] (u16 or u32)
 *   + 엣지 인덱스, 확장(octvertexnormals 등) — 미사용
 */

export interface ParsedQuantizedMesh {
  /** 수평 좌표, [0, 1] 정규화 (0=서쪽, 1=동쪽) */
  u: Float32Array;
  /** 수직 좌표, [0, 1] 정규화 (0=남쪽, 1=북쪽) */
  v: Float32Array;
  /** 고도, [0, 1] 정규화 */
  height: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** 타일 최저 고도 (meters) */
  minHeight: number;
  /** 타일 최고 고도 (meters) */
  maxHeight: number;
  vertexCount: number;
  triangleCount: number;
}

/** zig-zag delta 디코딩 */
function zigzagDecode(n: number): number {
  return (n >> 1) ^ (-(n & 1));
}

export function parseQuantizedMesh(buffer: ArrayBuffer): ParsedQuantizedMesh {
  const view = new DataView(buffer);

  // Header (88 bytes)
  // Offset  0: centerX (f64)
  // Offset  8: centerY (f64)
  // Offset 16: centerZ (f64)
  // Offset 24: minimumHeight (f32)
  // Offset 28: maximumHeight (f32)
  // Offset 32: boundingSphere center (f64×3) + radius (f64) = 32 bytes
  // Offset 64: horizonOcclusionPoint (f64×3) = 24 bytes
  const minHeight = view.getFloat32(24, true);
  const maxHeight = view.getFloat32(28, true);

  // Vertex data
  const vertexCount = view.getUint32(88, true);

  const uStart = 92;
  const vStart = uStart + vertexCount * 2;
  const hStart = vStart + vertexCount * 2;

  // slice()로 복사하여 정렬 보장 (buffer.slice()는 항상 새 ArrayBuffer 반환)
  const uRaw = new Uint16Array(buffer.slice(uStart, uStart + vertexCount * 2));
  const vRaw = new Uint16Array(buffer.slice(vStart, vStart + vertexCount * 2));
  const hRaw = new Uint16Array(buffer.slice(hStart, hStart + vertexCount * 2));

  const u = new Float32Array(vertexCount);
  const v = new Float32Array(vertexCount);
  const height = new Float32Array(vertexCount);

  let uVal = 0;
  let vVal = 0;
  let hVal = 0;
  for (let i = 0; i < vertexCount; i++) {
    uVal += zigzagDecode(uRaw[i]);
    vVal += zigzagDecode(vRaw[i]);
    hVal += zigzagDecode(hRaw[i]);
    u[i] = uVal / 32767;
    v[i] = vVal / 32767;
    height[i] = hVal / 32767;
  }

  // 인덱스 데이터 — 이 서버는 4-byte 정렬 패딩 없이 vertex 데이터 직후에 시작
  const vertexDataEnd = hStart + vertexCount * 2;
  const indexDataStart = vertexDataEnd;

  const triangleCount = view.getUint32(indexDataStart, true);
  const indexStart = indexDataStart + 4;

  let indices: Uint16Array | Uint32Array;
  if (vertexCount > 65536) {
    indices = new Uint32Array(
      buffer.slice(indexStart, indexStart + triangleCount * 3 * 4),
    );
  } else {
    indices = new Uint16Array(
      buffer.slice(indexStart, indexStart + triangleCount * 3 * 2),
    );
  }

  // HWM 디코딩 (Cesium quantized-mesh spec)
  let highest = 0;
  for (let i = 0; i < indices.length; i++) {
    const code = indices[i];
    indices[i] = highest - code;
    if (code === 0) highest++;
  }

  return { u, v, height, indices, minHeight, maxHeight, vertexCount, triangleCount };
}
