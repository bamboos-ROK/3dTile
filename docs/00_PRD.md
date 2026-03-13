# PRD

## 프로젝트 개요

### 목적

Heightmap 기반 지형 데이터를 사용하여

**Tile + LOD 기반 지형 렌더링 시스템**을 구현한다.

이 프로젝트의 목표는 **지도 엔진의 핵심 구조를 이해하는 것**이다.

#### 핵심 개념

- Tile System
- Terrain Mesh
- LOD (Level of Detail)
- Tile Traversal
- Tile Streaming

#### 기술 스택

- Babylon.js
- TypeScript

---

## 시스템 구조

### 전체 렌더링 흐름

1. Camera Update
2. Frustum Culling
3. Tile Traversal
4. LOD Selection
5. Tile Streaming
6. Terrain Mesh 생성
7. Render

---

### 프로젝트 구조

```
src

engine
 ├ camera
 │   └ CameraController
 │
 ├ tiling
 │   ├ TilingScheme
 │   └ LocalGridTiling
 │
 ├ terrain
 │   ├ TerrainTile
 │   ├ TerrainTileManager
 │   └ TerrainMeshBuilder
 │
 ├ lod
 │   └ LODSelector
 │
 └ renderer
     └ TerrainRenderer
```

---

### 핵심 클래스

#### TerrainTile

속성

- tileX
- tileY
- level
- mesh
- boundingVolume

#### TerrainTileManager

역할

- tile 생성
- tile 제거
- tile 캐싱 관리

#### TerrainMeshBuilder

역할

- heightmap sampling
- vertex 생성
- mesh 생성

#### LODSelector

역할

- camera distance 기반 LOD 계산

---

### DEMO 규모

#### 최대 타일 영역

16 × 16 tiles

#### 렌더링 정책

카메라 주변 **visible tiles only**

---

## 핵심 설계

지형 렌더링 시스템은 다음 구성 요소로 이루어진다.

### Tile System

#### 방식

Local Grid Tile

#### 확장 가능한 구조

```
TilingScheme
 ├ LocalGridTiling
 └ WebMercatorTiling (future)
```

#### 타일 좌표

- tileX : 타일 X 좌표
- tileY : 타일 Y 좌표
- level : 타일 LOD 레벨

#### 타일 구조

- Level 0 → 1 tile
- Level 1 → 4 tiles
- Level 2 → 16 tiles
- Level 3 → 64 tiles
- Level 4 → 256 tiles

#### 공간 분할

Quadtree

---

### Terrain 데이터

#### 데이터 형식

Heightmap

#### 처리 과정

heightmap image

→ pixel value (0~255)

→ height 값

→ terrain mesh 생성

#### 높이 계산

height = pixelValue × heightScale

---

### Terrain Mesh

#### 타일 해상도

32 × 32 vertices

#### Mesh 구조

Grid Mesh

#### Vertex 생성 과정

(x, y)

→ heightmap sampling

→ (x, y, height)

#### Triangle 구성

grid cell 하나당 2개의 triangle

---

### LOD 시스템

#### 방식

Tile LOD

#### 판단 기준

Camera distance

#### 동작 방식

- 카메라가 가까우면 → 높은 LOD
- 카메라가 멀어지면 → 낮은 LOD

#### LOD 구조

```
tile
 ├ children
 ├ bounding volume
 └ geometric error
```

---

### Tile Lifecycle

Terrain Tile은 카메라 이동에 따라 **생성 → 사용 → 제거**되는 생명주기를 가진다.

Tile Lifecycle은 **Tile Streaming 시스템**에서 관리된다.

#### 상태

- **Created:** 타일 객체가 생성된 상태
- **Loading:** heightmap 데이터 로딩 및 mesh 생성 중
- **Active:** scene에 존재하지만 화면에는 보이지 않는 상태
- **Visible:** 카메라 frustum 내부에 있어 렌더링되는 상태
- **Disposed:** 더 이상 필요 없어 mesh와 리소스가 제거된 상태

#### 흐름

1. **Created** : 카메라 이동 시 필요한 tile이 Created
2. **Loading**
3. **Active** : heightmap 기반 mesh 생성 후 Active
4. **Visible** : frustum 내부에 들어오면 Visible
5. **Active** : frustum 밖으로 나가면 다시 Active
6. **Disposed** : 더 이상 필요 없으면 Disposed

#### 관리 주체

TerrainTileManager

- tile 생성
- tile 상태 관리
- tile 제거

#### 트리거

Tile 상태는 다음 이벤트에 의해 변경된다.

- **Camera Movement**: Tile Traversal 실행
- **Tile Visibility 변경**: Active / Visible 전환
- **Tile Range 초과**: Dispose

---

### Tile Streaming

#### 방식

Dynamic Generation

#### 동작 과정

camera 이동

→ tile traversal

→ 필요한 tile 계산

→ tile 생성

→ terrain mesh 생성

#### 타일 제거

불필요한 타일은 dispose

---

## 구현 단계

### Step 1 — Babylon Scene 구성

구성 요소

- camera
- light
- basic scene

---

### Step 2 — Terrain Mesh 생성

Heightmap 기반으로 **single terrain mesh** 생성

---

### Step 3 — Tile Grid 시스템

terrain을 **tiles로 분할**

---

### Step 4 — Quadtree LOD

tile subdivision 구현

---

### Step 5 — Tile Traversal

visible tile selection 구현

---

### Step 6 — Dynamic Tile Streaming

tile 생성 및 제거 구현

---

## 최종 결과

### 데모 기능

- camera 이동
- terrain LOD 변화
- tile streaming

### 확인 가능한 것

- LOD 전환
- tile 생성 / 삭제
- terrain mesh 구조

### 향후 확장 가능성

- 좌표계 적용 : Web Mercator Projection
- 지도 타일 : Imagery Tile
- 3D 객체 : 3D Tiles
- 대표 구현 사례 : CesiumJS

---

## 샘플 시연 구성

### 목적

- 데모 엔진의 **Tile, LOD, Streaming 동작** 확인
- 실제 지도 데이터 처리 이전에 **엔진 구조 이해 및 검증** 목적

### 샘플 데이터

- Heightmap 이미지 1~2개 (간단한 256×256 흑백 이미지)
- Tile 수: 16×16
- TerrainMesh vertex 해상도: 32×32
- HeightScale: 적당히 조절하여 지형 볼륨 확인

### 시연 환경

- Babylon.js 기반 간단 Scene
- ArcRotateCamera로 이동/회전/줌 가능
- Babylon Inspector 사용 시, 다음 요소 확인 가능:
  - Tile mesh 구조
  - LOD 레벨
  - Bounding volume

### 동작 흐름

1. 데모 엔진이 샘플 Heightmap을 기반으로 TerrainTile 생성
2. 카메라 이동 시 Tile Traversal과 LODSelector가 동작
3. 필요 타일 생성 / 불필요 타일 제거
4. 카메라 시점에 따른 LOD 변화 및 mesh 구조 확인 가능

> 데모 목적상 실제 지형 데이터 처리보다는 **엔진 동작 확인용**으로 구성됨
