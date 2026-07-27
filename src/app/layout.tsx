import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard 가변 폰트 셀프호스팅 (원본: npm pretendard 패키지)
const pretendard = localFont({
  src: "../fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "above",
  description: "사진에 예쁜 프레임을 씌워 인스타그램용 이미지로 만들어 보세요",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        {/* 라우트 페이지뷰가 곧 지표 (PRD §2) — 대시보드 활성화는 Vercel 프로젝트 설정에서 */}
        <Analytics />
      </body>
    </html>
  );
}
