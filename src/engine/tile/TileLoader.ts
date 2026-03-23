export interface TileLoader {
  loadDEM(x: number, y: number, z: number): Promise<Float32Array>;
  loadTexture(x: number, y: number, z: number): Promise<unknown>;
}
