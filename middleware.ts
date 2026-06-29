// /api/* 공유 시크릿 게이트. 클라이언트는 x-editor-secret 헤더로 EDITOR_SHARED_SECRET 전송.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = { matcher: "/api/:path*" };

export function middleware(req: NextRequest) {
  const secret = process.env.EDITOR_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server misconfigured: EDITOR_SHARED_SECRET 미설정" }, { status: 500 });
  }
  if (req.headers.get("x-editor-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}
