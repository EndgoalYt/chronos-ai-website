import { corsHeaders, HttpError, readJson, requireUser } from "./http.ts";

Deno.test("unauthenticated requests are rejected before creating a Supabase client", async () => {
  try {
    await requireUser(new Request("https://example.test", { method: "POST" }));
    throw new Error("Expected an authentication error.");
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
  }
});

Deno.test("JSON body parsing rejects invalid and oversized request bodies", async () => {
  await expectHttpError(
    () => readJson(new Request("https://example.test", { method: "POST", body: "{" })),
    400,
  );
  await expectHttpError(
    () => readJson(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(17_000) }),
    })),
    413,
  );
});

Deno.test("CORS allows only the configured site origin", () => {
  const previous = Deno.env.get("SITE_URL");
  Deno.env.set("SITE_URL", "https://example.github.io");
  try {
    const allowed = corsHeaders(new Request("https://api.example.test", {
      headers: { origin: "https://example.github.io" },
    }));
    const denied = corsHeaders(new Request("https://api.example.test", {
      headers: { origin: "https://attacker.example" },
    }));
    if (allowed["access-control-allow-origin"] !== "https://example.github.io") {
      throw new Error("The configured site origin should be allowed.");
    }
    if ("access-control-allow-origin" in denied) {
      throw new Error("An unconfigured origin must not receive CORS permission.");
    }
  } finally {
    if (previous === undefined) Deno.env.delete("SITE_URL");
    else Deno.env.set("SITE_URL", previous);
  }
});

async function expectHttpError(
  action: () => Promise<unknown>,
  status: number,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof HttpError && error.status === status) return;
    throw error;
  }
  throw new Error(`Expected HTTP ${status}.`);
}
