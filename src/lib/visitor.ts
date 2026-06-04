import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

const VISITOR_COOKIE = "observer_visitor_id";
const VISITOR_MAX_AGE = 60 * 60 * 24 * 365;
const VISITOR_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;

export type VisitorContext = {
  visitorId: string;
  isNewVisitor: boolean;
};

export function getVisitor(request: NextRequest): VisitorContext {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  if (existing && VISITOR_ID_PATTERN.test(existing)) {
    return { visitorId: existing, isNewVisitor: false };
  }

  return {
    visitorId: crypto.randomUUID(),
    isNewVisitor: true,
  };
}

export function withVisitorCookie<T>(
  response: NextResponse<T>,
  visitor: VisitorContext,
): NextResponse<T> {
  if (!visitor.isNewVisitor) return response;

  response.cookies.set(VISITOR_COOKIE, visitor.visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_MAX_AGE,
  });
  return response;
}
