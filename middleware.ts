// /api/* 게이트. 읽기 전용(조회/판정)은 무인증 — 스토리지 조회에 시크릿 입력 불필요.
// 외부 자산을 실제로 생성하는 쓰기(/api/upload)만 공유 시크릿(EDITOR_SHARED_SECRET) 요구.
// 클라이언트는 쓰기 시에만 x-editor-secret 헤더로 전송한다.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = { matcher: "/api/:path*" };

// 시크릿이 필요한 경로(외부 자산 변경). 나머지 /api/* 는 읽기 전용 → 무인증 통과.
const PROTECTED = new Set(["/api/upload"]);

export function middleware(req: NextRequest) {
  if (!PROTECTED.has(req.nextUrl.pathname)) return NextResponse.next();

  const secret = process.env.EDITOR_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server misconfigured: EDITOR_SHARED_SECRET 미설정" }, { status: 500 });
  }
  if (req.headers.get("x-editor-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}
