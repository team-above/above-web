/**
 * OG 공유 이미지 생성: Sample01 시안 크롭 + 흰색 로고 → public/og.jpg (1200×630).
 * 실행: node scripts/derive-og.ts (로고·샘플 시안 교체 시 재실행)
 */
import path from "node:path";
import sharp from "sharp";

const ROOT = path.join(import.meta.dirname, "..");

const whiteLogo = await sharp(path.join(ROOT, "public/logo-black.png"))
  .negate({ alpha: false }) // 검정 로고 → 흰색 (알파 유지)
  .resize({ height: 72 })
  .png()
  .toBuffer();

await sharp(path.join(ROOT, "docs/design/frames/Sample01.png"))
  .resize(1200, 1500) // 2160×2700 → 1200×1500
  .extract({ left: 0, top: 435, width: 1200, height: 630 }) // 사진 중심 밴드
  .composite([{ input: whiteLogo, left: 60, top: 510 }])
  .jpeg({ quality: 85 })
  .toFile(path.join(ROOT, "public/og.jpg"));

console.log("완료: public/og.jpg (1200×630)");
