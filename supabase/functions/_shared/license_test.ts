import { HttpError } from "./http.ts";
import {
  createSignedLicense,
  getPublicLicenseJwks,
  type PublicLicenseJwk,
} from "./license.ts";

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

Deno.test("public entitlement JWKS contains only public P-256 material when signing is not configured", async () => {
  const previousPrivateKey = Deno.env.get("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  const previousKeyId = Deno.env.get("ENTITLEMENT_SIGNING_KEY_ID");
  const previousPublicJwks = Deno.env.get("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS");
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  Deno.env.delete("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  Deno.env.delete("ENTITLEMENT_SIGNING_KEY_ID");
  Deno.env.set("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS", JSON.stringify([
    { ...publicJwk, kid: "retained-key" },
  ]));

  try {
    const jwks = await getPublicLicenseJwks();
    if (jwks.keys.length !== 1) throw new Error("The retained public key was not published.");
    const [key] = jwks.keys;
    if (
      key.kid !== "retained-key" || key.kty !== "EC" || key.crv !== "P-256" ||
      key.alg !== "ES256" || key.use !== "sig" || "d" in key
    ) {
      throw new Error("JWKS must contain only normalized public ES256/P-256 keys.");
    }
    if (JSON.stringify(jwks).includes('"d"')) {
      throw new Error("Private key material must never appear in the public JWKS.");
    }
  } finally {
    restoreEnv("ENTITLEMENT_SIGNING_PRIVATE_JWK", previousPrivateKey);
    restoreEnv("ENTITLEMENT_SIGNING_KEY_ID", previousKeyId);
    restoreEnv("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS", previousPublicJwks);
  }
});

Deno.test("entitlement JWKS key rotation retains old verification keys and publishes the active kid", async () => {
  const previousPrivateKey = Deno.env.get("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  const previousKeyId = Deno.env.get("ENTITLEMENT_SIGNING_KEY_ID");
  const previousPublicJwks = Deno.env.get("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS");
  const oldPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const newPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const oldPrivateJwk = await crypto.subtle.exportKey("jwk", oldPair.privateKey);
  const oldPublicJwk = await crypto.subtle.exportKey("jwk", oldPair.publicKey);
  const newPrivateJwk = await crypto.subtle.exportKey("jwk", newPair.privateKey);

  try {
    Deno.env.set("ENTITLEMENT_SIGNING_PRIVATE_JWK", JSON.stringify(oldPrivateJwk));
    Deno.env.set("ENTITLEMENT_SIGNING_KEY_ID", "old-key");
    const oldLicense = await createSignedLicense("user", "ultimate", true, true);
    if (!oldLicense) throw new Error("The old licence was not issued.");

    Deno.env.set("ENTITLEMENT_SIGNING_PRIVATE_JWK", JSON.stringify(newPrivateJwk));
    Deno.env.set("ENTITLEMENT_SIGNING_KEY_ID", "new-key");
    Deno.env.set("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS", JSON.stringify([
      { ...oldPublicJwk, kid: "old-key" },
    ]));
    const newLicense = await createSignedLicense("user", "ultimate", true, true);
    if (!newLicense) throw new Error("The new licence was not issued.");

    const jwks = await getPublicLicenseJwks();
    if (jwks.keys.map((key) => key.kid).sort().join(",") !== "new-key,old-key") {
      throw new Error("The rotated JWKS must contain both old and active key IDs.");
    }
    await assertLicenseVerifies(oldLicense.token, jwks.keys.find((key) => key.kid === "old-key"));
    await assertLicenseVerifies(newLicense.token, jwks.keys.find((key) => key.kid === "new-key"));
    if (newLicense.keyId !== "new-key") throw new Error("The new licence has the wrong key ID.");
  } finally {
    restoreEnv("ENTITLEMENT_SIGNING_PRIVATE_JWK", previousPrivateKey);
    restoreEnv("ENTITLEMENT_SIGNING_KEY_ID", previousKeyId);
    restoreEnv("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS", previousPublicJwks);
  }
});

async function assertLicenseVerifies(
  token: string,
  jwk: PublicLicenseJwk | undefined,
): Promise<void> {
  if (!jwk) throw new Error("No matching public key was found.");
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const header = JSON.parse(decodeBase64Url(encodedHeader));
  if (header.kid !== jwk.kid) throw new Error("The token kid does not match the selected public key.");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
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
  if (!valid) throw new Error(`The ${header.kid} licence signature could not be verified.`);
}

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
