export interface HeightmapData {
  heights: Float32Array; // R채널 / 255, 범위 0–1
  width: number;
  height: number;
}

/** heightmap PNG를 로드하여 픽셀 데이터 반환 */
export async function loadHeightmap(url: string): Promise<HeightmapData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const rgba = imageData.data;
      const heights = new Float32Array(img.width * img.height);
      for (let i = 0; i < heights.length; i++) {
        heights[i] = rgba[i * 4] / 255;
      }

      resolve({ heights, width: img.width, height: img.height });
    };
    img.onerror = () => reject(new Error(`Failed to load heightmap: ${url}`));
    img.src = url;
  });
}
