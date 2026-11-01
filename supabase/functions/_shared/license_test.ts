import { HttpError } from "./http.ts";
import { createSignedLicense } from "./license.ts";

Deno.test("Ultimate licences are signed ES256 tokens valid for exactly 90 days", async () => {
  const previousPrivateKey = Deno.env.get("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  const previousKeyId = Deno.env.get("ENTITLEMENT_SIGNING_KEY_ID");
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  Deno.env.set("ENTITLEMENT_SIGNING_PRIVATE_JWK", JSON.stringify(privateJwk));
  Deno.env.set("ENTITLEMENT_SIGNING_KEY_ID", "test-key-1");

  try {
    const userId = "f48658f9-3c72-4f29-86d5-4921582b3a5e";
    const license = await createSignedLicense(userId, "ultimate", true, true);
    if (!license) throw new Error("Ultimate licence was not issued.");

    const [encodedHeader, encodedPayload, encodedSignature] = license.token.split(".");
    const header = JSON.parse(decodeBase64Url(encodedHeader));
    const claims = JSON.parse(decodeBase64Url(encodedPayload));
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      decodeBase64UrlBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );

    if (!valid) throw new Error("Licence signature could not be verified.");
    if (header.alg !== "ES256" || header.kid !== "test-key-1") {
      throw new Error("Licence signing metadata is incorrect.");
    }
    if (
      claims.sub !== userId ||
      claims.edition !== "ultimate" ||
      claims.aud !== "chronos-ai-windows" ||
      claims.entitlements.offline_ai !== true ||
      claims.exp - claims.iat !== 90 * 24 * 60 * 60
    ) {
      throw new Error("Ultimate licence claims or 90-day expiry are incorrect.");
    }
    if (license.expiresAt !== new Date(claims.exp * 1000).toISOString()) {
      throw new Error("Licence expiry response does not match the signed claim.");
    }
  } finally {
    restoreEnv("ENTITLEMENT_SIGNING_PRIVATE_JWK", previousPrivateKey);
    restoreEnv("ENTITLEMENT_SIGNING_KEY_ID", previousKeyId);
  }
});

Deno.test("a partial signing-key configuration fails closed", async () => {
  const previousPrivateKey = Deno.env.get("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  const previousKeyId = Deno.env.get("ENTITLEMENT_SIGNING_KEY_ID");
  Deno.env.set("ENTITLEMENT_SIGNING_PRIVATE_JWK", "{}");
  Deno.env.delete("ENTITLEMENT_SIGNING_KEY_ID");
  try {
    try {
      await createSignedLicense("user", "ultimate", true, true);
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) return;
      throw error;
    }
    throw new Error("Incomplete signing configuration must fail.");
  } finally {
    restoreEnv("ENTITLEMENT_SIGNING_PRIVATE_JWK", previousPrivateKey);
    restoreEnv("ENTITLEMENT_SIGNING_KEY_ID", previousKeyId);
  }
});

function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
}
