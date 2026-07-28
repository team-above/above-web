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

const DESCRIPTION =
  "사진에 예쁜 프레임을 씌워 인스타그램용 이미지로 만들어 보세요";

// metadataBase는 Vercel 배포에서 VERCEL_PROJECT_PRODUCTION_URL로 자동 해석된다
export const metadata: Metadata = {
  title: "above",
  description: DESCRIPTION,
  openGraph: {
    title: "above",
    description: DESCRIPTION,
    siteName: "above",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "above" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "above",
    description: DESCRIPTION,
    images: ["/og.jpg"],
  },
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
