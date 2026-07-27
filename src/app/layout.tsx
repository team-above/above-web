import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
