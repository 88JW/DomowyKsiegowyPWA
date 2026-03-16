import { NextRequest, NextResponse } from "next/server";

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons")
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const ssoUser = req.headers.get("x-forwarded-user")?.trim();
  if (ssoUser) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "SSO required: missing X-Forwarded-User" },
      { status: 401 }
    );
  }

  return new NextResponse("SSO required", { status: 401 });
}

export const config = {
  matcher: ["/:path*"],
};
