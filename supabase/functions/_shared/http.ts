import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "request_failed",
  ) {
    super(message);
  }
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  const siteUrl = Deno.env.get("SITE_URL");
  const origin = request.headers.get("origin");

  if (siteUrl && origin) {
    try {
      if (new URL(origin).origin === new URL(siteUrl).origin) {
        headers["access-control-allow-origin"] = origin;
      }
    } catch {
      throw new HttpError(500, "The configured site URL is invalid.", "configuration_error");
    }
  }

  return headers;
}

export function serve(
  handler: (request: Request) => Promise<Response>,
): void {
  Deno.serve(async (request) => {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      const response = await handler(request);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(corsHeaders(request))) {
        headers.set(name, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(request, { error: error.message, code: error.code }, error.status);
      }
      console.error("Unhandled payment function error:", error);
      return jsonResponse(request, {
        error: "The request could not be completed. Please try again.",
        code: "internal_error",
      }, 500);
    }
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) {
    throw new HttpError(413, "Request body is too large.", "payload_too_large");
  }

  let value: unknown;
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 16_384) {
    throw new HttpError(413, "Request body is too large.", "payload_too_large");
  }
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "A valid JSON request body is required.", "invalid_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "A JSON object is required.", "invalid_body");
  }
  return value as Record<string, unknown>;
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(503, `Payment service configuration is missing ${name}.`, "configuration_error");
  }
  return value;
}

export function createAdminClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function requireUser(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    throw new HttpError(401, "Sign in to continue.", "authentication_required");
  }

  const client = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "Your session is invalid or expired. Sign in again.", "invalid_session");
  }
  return data.user;
}

export function requirePost(request: Request): void {
  if (request.method !== "POST") {
    throw new HttpError(405, "Use POST for this endpoint.", "method_not_allowed");
  }
}

export function requireGet(request: Request): void {
  if (request.method !== "GET") {
    throw new HttpError(405, "Use GET for this endpoint.", "method_not_allowed");
  }
}
