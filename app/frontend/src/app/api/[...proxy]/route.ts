/**
 * Next.js API route proxy — forwards all /api/* requests to the FastAPI backend.
 * Avoids CORS issues in production; lets the frontend use relative URLs.
 * Falls back gracefully if the backend is unreachable.
 */
import { type NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  const { proxy } = await params;
  const path = "/" + proxy.join("/");
  const search = request.nextUrl.search;
  const url = `${API_BASE}${path}${search}`;

  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 0 },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable", path },
      { status: 503 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> }
) {
  const { proxy } = await params;
  const path = "/" + proxy.join("/");
  const url = `${API_BASE}${path}`;

  try {
    const body = await request.text();
    const contentType = request.headers.get("content-type") ?? "application/json";
    const res = await fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": contentType },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable", path },
      { status: 503 }
    );
  }
}
