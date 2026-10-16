import type { Metadata } from "next";
import "./globals.css";
import PageViewTracker from "@/components/ops/PageViewTracker";
export const metadata:Metadata={title:{default:"네이버 블로그 AI 브리핑 인용 진단",template:"%s | NAEO"},description:"네이버 AI 검색 최적화 진단 · NAEO",robots:{index:false,follow:false},icons:{icon:"/seo/icon.png"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko" className="dark" suppressHydrationWarning><body>{children}<PageViewTracker/></body></html>}
