import { HttpError } from "./http.ts";

export async function createSignedLicense(
  userId: string,
  edition: string,
  plus: boolean,
  ultimate: boolean,
): Promise<{ token: string; expiresAt: string; keyId: string } | null> {
  const rawPrivateKey = Deno.env.get("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  const keyId = Deno.env.get("ENTITLEMENT_SIGNING_KEY_ID");
  if (!rawPrivateKey && !keyId) return null;
  if (!rawPrivateKey || !keyId || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new HttpError(503, "Offline entitlement signing configuration is incomplete.", "license_configuration_error");
  }

  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(rawPrivateKey) as JsonWebKey;
  } catch {
    throw new HttpError(503, "Offline entitlement signing key is invalid.", "license_configuration_error");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string") {
    throw new HttpError(503, "Offline entitlement signing key must be an ES256 private key.", "license_configuration_error");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresSeconds = nowSeconds + 90 * 24 * 60 * 60;
  const header = encodeBase64Url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: keyId }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: "https://chronos-ai-entitlements",
    aud: "chronos-ai-windows",
    sub: userId,
    iat: nowSeconds,
    exp: expiresSeconds,
    edition,
    entitlements: { plus, ultimate, offline_ai: ultimate },
  }));
  const signingInput = `${header}.${payload}`;
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new HttpError(503, "Offline entitlement signing key could not be loaded.", "license_configuration_error");
  }
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  ));
  const expiresAt = new Date(expiresSeconds * 1000).toISOString();
  return {
    token: `${signingInput}.${encodeBase64Url(signature)}`,
    expiresAt,
    keyId,
  };
}

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
