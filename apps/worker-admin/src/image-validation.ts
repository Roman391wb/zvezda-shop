import { AppError } from "./errors";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 32_000_000;

export type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp"; width: number; height: number };

function dimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) throw new AppError(422, "invalid_media_dimensions", "Недопустимые размеры изображения");
  return { width, height };
}

function png(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]; const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { mime: "image/png", extension: "png", ...dimensions(width >>> 0, height >>> 0) };
}

function jpeg(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  for (let offset = 2; offset + 8 < bytes.length;) { while (bytes[offset] === 0xff) offset += 1; const marker = bytes[offset++]; if (marker === 0xd9 || marker === 0xda) break; if (marker >= 0xd0 && marker <= 0xd7) continue; if (offset + 2 > bytes.length) break; const length = (bytes[offset] << 8) | bytes[offset + 1]; if (length < 2 || offset + length > bytes.length) break; if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) return { mime: "image/jpeg", extension: "jpg", ...dimensions((bytes[offset + 5] << 8) | bytes[offset + 6], (bytes[offset + 3] << 8) | bytes[offset + 4]) }; offset += length; }
  return null;
}

function webp(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 30 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") return null;
  const type = String.fromCharCode(...bytes.slice(12, 16)); const offset = 20;
  if (type === "VP8X" && bytes.length >= 30) return { mime: "image/webp", extension: "webp", ...dimensions(1 + bytes[offset + 4] + (bytes[offset + 5] << 8) + (bytes[offset + 6] << 16), 1 + bytes[offset + 7] + (bytes[offset + 8] << 8) + (bytes[offset + 9] << 16)) };
  if (type === "VP8 " && bytes.length >= 30 && bytes[offset + 3] === 0x9d && bytes[offset + 4] === 0x01 && bytes[offset + 5] === 0x2a) return { mime: "image/webp", extension: "webp", ...dimensions(((bytes[offset + 7] & 0x3f) << 8) | bytes[offset + 6], ((bytes[offset + 9] & 0x3f) << 8) | bytes[offset + 8]) };
  if (type === "VP8L" && bytes.length >= 25 && bytes[offset] === 0x2f) return { mime: "image/webp", extension: "webp", ...dimensions(1 + ((bytes[offset + 1] | (bytes[offset + 2] << 8)) & 0x3fff), 1 + (((bytes[offset + 2] >> 6) | (bytes[offset + 3] << 2) | (bytes[offset + 4] << 10)) & 0x3fff)) };
  return null;
}

export function validateImage(bytes: Uint8Array): ImageKind {
  if (bytes.byteLength < 24 || bytes.byteLength > MAX_IMAGE_BYTES) throw new AppError(413, "invalid_media_size", "Недопустимый размер изображения");
  const image = png(bytes) ?? jpeg(bytes) ?? webp(bytes); if (!image) throw new AppError(422, "invalid_media", "Разрешены только корректные JPEG, PNG и WebP");
  return image;
}
