import { HttpError } from "./http.ts";

export interface PublicLicenseJwk extends JsonWebKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
  alg: "ES256";
  use: "sig";
}

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

  const jwk = parseSigningJwk(rawPrivateKey);

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

export async function getPublicLicenseJwks(): Promise<{ keys: PublicLicenseJwk[] }> {
  const rawPrivateKey = Deno.env.get("ENTITLEMENT_SIGNING_PRIVATE_JWK");
  const keyId = Deno.env.get("ENTITLEMENT_SIGNING_KEY_ID");
  const keys: PublicLicenseJwk[] = [];

  if (rawPrivateKey || keyId) {
    if (!rawPrivateKey || !keyId || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
      throw licenseConfigurationError("Offline entitlement signing configuration is incomplete.");
    }
    const signingJwk = parseSigningJwk(rawPrivateKey);
    keys.push(await createPublicJwk({
      kty: signingJwk.kty,
      crv: signingJwk.crv,
      x: signingJwk.x,
      y: signingJwk.y,
    }, keyId));
  }

  const rawPreviousKeys = Deno.env.get("ENTITLEMENT_PREVIOUS_PUBLIC_JWKS");
  if (rawPreviousKeys?.trim()) {
    let previousKeys: unknown;
    try {
      previousKeys = JSON.parse(rawPreviousKeys);
    } catch {
      throw licenseConfigurationError("Offline entitlement public keys are invalid.");
    }
    if (!Array.isArray(previousKeys)) {
      throw licenseConfigurationError("Offline entitlement public keys must be a JSON array.");
    }
    for (const jwk of previousKeys) {
      keys.push(await createPublicJwk(jwk));
    }
  }

  const keyIds = new Set<string>();
  for (const key of keys) {
    if (keyIds.has(key.kid)) {
      throw licenseConfigurationError("Offline entitlement public key identifiers must be unique.");
    }
    keyIds.add(key.kid);
  }
  return { keys };
}

function parseSigningJwk(rawPrivateKey: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPrivateKey);
  } catch {
    throw licenseConfigurationError("Offline entitlement signing key is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw licenseConfigurationError("Offline entitlement signing key is invalid.");
  }
  const jwk = parsed as JsonWebKey;
  if (
    jwk.kty !== "EC" || jwk.crv !== "P-256" ||
    typeof jwk.d !== "string" || typeof jwk.x !== "string" ||
    typeof jwk.y !== "string"
  ) {
    throw licenseConfigurationError("Offline entitlement signing key must be an ES256 private key.");
  }
  return jwk;
}

async function createPublicJwk(
  jwk: unknown,
  keyId?: string,
): Promise<PublicLicenseJwk> {
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) {
    throw licenseConfigurationError("Offline entitlement public key is invalid.");
  }
  const candidate = jwk as Record<string, unknown>;
  const kid = keyId ?? candidate.kid;
  if (
    candidate.kty !== "EC" || candidate.crv !== "P-256" ||
    typeof candidate.x !== "string" || typeof candidate.y !== "string" ||
    typeof kid !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(kid) ||
    "d" in candidate
  ) {
    throw licenseConfigurationError(
      "Offline entitlement public key must be a public ES256/P-256 JWK with a valid kid.",
    );
  }

  const publicJwk: PublicLicenseJwk = {
    kty: "EC",
    crv: "P-256",
    x: candidate.x,
    y: candidate.y,
    kid,
    alg: "ES256",
    use: "sig",
  };
  try {
    if (
      decodeBase64UrlBytes(publicJwk.x).length !== 32 ||
      decodeBase64UrlBytes(publicJwk.y).length !== 32
    ) {
      throw new Error("Invalid P-256 coordinate length.");
    }
    await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    throw licenseConfigurationError("Offline entitlement public key is not a valid P-256 key.");
  }
  return publicJwk;
}

function licenseConfigurationError(message: string): HttpError {
  return new HttpError(503, message, "license_configuration_error");
}

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
