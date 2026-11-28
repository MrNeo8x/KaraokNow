// Browser-side image compression before upload (PD-037: keep files small to stay inside the free Blob quota).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Scale to fit the longest side within maxSide, never upscaling. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Quality ladder tried from best to smallest. */
export const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5];

export function imageTypeError(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.';
  if (file.size > 25 * 1024 * 1024) return 'Ảnh gốc quá lớn (trên 25 MB).';
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type CompressedImage = { file: File; width: number; height: number; originalBytes: number };

/**
 * Re-encodes an image (always, which also strips EXIF/GPS metadata and applies orientation) to WebP, or JPEG on
 * browsers that cannot encode WebP. Lowers quality, then size, until it fits targetBytes (and the 4 MB hard limit).
 */
export async function compressImage(source: File, { maxSide = 1600, targetBytes = 500 * 1024 } = {}): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  try {
    let side = maxSide;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
      let best: Blob | null = null; let type = 'image/webp';
      for (const quality of QUALITY_STEPS) {
        context.clearRect(0, 0, width, height);
        if (type === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
        context.drawImage(bitmap, 0, 0, width, height);
        let blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
        if (blob && blob.type !== type && type === 'image/webp') { type = 'image/jpeg'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality)); }
        if (!blob) continue;
        best = blob;
        if (blob.size <= targetBytes) break;
      }
      if (best && (best.size <= targetBytes || (attempt === 3 && best.size <= MAX_UPLOAD_BYTES))) {
        const name = source.name.replace(/\.[^.]+$/, '') + (best.type === 'image/webp' ? '.webp' : '.jpg');
        return { file: new File([best], name, { type: best.type }), width, height, originalBytes: source.size };
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('Không nén được ảnh xuống dưới 4 MB. Hãy chọn ảnh khác.');
  } finally { bitmap.close(); }
}
