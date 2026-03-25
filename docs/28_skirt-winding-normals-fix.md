# 28 — Skirt 와인딩 & 법선 버그픽스

## 배경

Quantized-Mesh 타일의 LOD 경계 seam을 감추기 위해 Skirt geometry(아래로 드리우는 수직 "치마")를 추가했다.
구현 후 두 가지 버그가 발생했다.

1. **법선 오염(Normal Contamination)** — 동일 LOD 타일 경계에 뚜렷한 줄이 생김
2. **South 엣지 invisible** — South 방향 skirt만 solid 모드에서 보이지 않음

---

## 버그 1: 법선 오염 (타일 경계선)

### 원인

`VertexData.ComputeNormals(allPositions, allIndices)`는 skirt 삼각형(수직면)까지 포함해 법선을 계산한다.
경계 vertex는 terrain 삼각형 + skirt 수직 삼각형 양쪽에 공유되므로, 법선이 아래(-Y) 방향으로 당겨진다.
→ 경계 vertex의 조명값이 인접 vertex와 달라져 동일 LOD 타일 사이에 줄이 생긴다.

### 수정

terrain 법선과 skirt 법선을 **분리해서 계산**한다.

```typescript
// terrain 법선: main geometry만으로 계산
const mainNormals: number[] = [];
VertexData.ComputeNormals(mainPositions, indices, mainNormals);

// skirt 법선: (0,-1,0) 고정
// seam 은폐 목적 → 조명 영향 최소화 (아래 방향 법선 = 직사광 dot≈0 = 어둡게 → gap과 동화)
const skirtNormals = new Float32Array(skirtVertCount * 3);
for (let i = 0; i < skirtVertCount; i++) {
  skirtNormals[i * 3 + 1] = -1;
}
```

### 결과

- terrain 법선이 skirt에 의해 왜곡되지 않음 → 동일 LOD 경계 줄 제거
- skirt는 항상 어둡게 렌더링 → gap 색상과 자연스럽게 동화

---

## 버그 2: South 엣지 Skirt Invisible (와인딩 버그)

### 원인 분석

WebGL 기본 front face 기준: **screen space CCW = front face**.
Babylon.js는 left-handed 좌표계: X=East, Y=Up, Z=North.

카메라 방향별 screen right 방향 (`camera_right = up × forward`):

| 엣지 | 카메라 forward | screen right | 정렬 순서 (sort=u or v) | a 위치 | (a,b,sb) 와인딩 |
|------|--------------|-------------|----------------------|--------|----------------|
| North (v≈1) | -Z | -X | u 오름차순 → a=West(small u) | RIGHT | CCW ✓ |
| South (v≈0) | +Z | +X | u 오름차순 → a=West(small u) | LEFT  | CW ✗ → 반전 필요 |
| West  (u≈0) | +X | -Z | v 오름차순 → a=South(small v) | RIGHT | CCW ✓ |
| East  (u≈1) | -X | +Z | v 오름차순 → a=South(small v) | LEFT  | CW ✗ → 반전 필요 |

South와 East는 `(a,b,sb)` 순서가 CW → back face → 화면에 보이지 않는다.
반전 패턴 `(a,sa,sb),(a,sb,b)`을 사용해야 CCW가 된다.

### 수정 전

```typescript
addEdgeSkirts(north, false);  // ✓
addEdgeSkirts(south, false);  // ✗ CW = back face
addEdgeSkirts(west,  false);  // ✓
addEdgeSkirts(east,  true);   // ✓
```

### 수정 후

```typescript
addEdgeSkirts(north, false);  // flip=false: CCW 자연 달성
addEdgeSkirts(south, true);   // flip=true:  CW → 반전
addEdgeSkirts(west,  false);  // flip=false: CCW 자연 달성
addEdgeSkirts(east,  true);   // flip=true:  CW → 반전
```

---

## 파라미터명 정리

기존 파라미터명 `northOrWest`는 의미가 반대였다 (`true` = South/East).
→ `flip`으로 rename.

```typescript
// 이전
function addSkirtQuad(a: number, b: number, northOrWest: boolean)

// 이후
// flip=false: camera right = -축 → a=RIGHT, b=LEFT → (a,b,sb) CCW ✓  (North, West)
// flip=true:  camera right = +축 → a=LEFT,  b=RIGHT → (a,b,sb) CW  → 반전   (South, East)
function addSkirtQuad(a: number, b: number, flip: boolean)
```

---

## 변경 파일

- [src/engine/tile/QuantizedMeshTileLoader.ts](../src/engine/tile/QuantizedMeshTileLoader.ts)
  - `buildMesh()` — terrain/skirt 법선 분리 계산
  - `addSkirtQuad()` — 파라미터명 `northOrWest` → `flip`, 주석 수정
  - `addEdgeSkirts()` — 파라미터명 동기화
  - `addEdgeSkirts(south, false)` → `addEdgeSkirts(south, true)`
