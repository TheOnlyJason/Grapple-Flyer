// Minimal App Store Connect API caller.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=… node scripts/asc.mjs METHOD PATH [JSON | @file]
//
// Signs a short-lived ES256 JWT with the team API key (never logged) and
// prints the HTTP status plus response body. Used by the release flow to
// register identifiers, inspect app records, and upload listing metadata.
import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_KEY_PATH;
if (!KEY_ID || !ISSUER || !KEY_PATH) {
  console.error("Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH.");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const payload = {
    iss: ISSUER,
    iat: now,
    exp: now + 1200, // ASC max is 20 minutes
    aud: "appstoreconnect-v1",
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(readFileSync(KEY_PATH));
  const sig = sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(sig)}`;
}

const [method, path, body] = process.argv.slice(2);
if (!method || !path) {
  console.error("Usage: node scripts/asc.mjs METHOD /v1/... [JSON | @file.json]");
  process.exit(1);
}

const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
  method: method.toUpperCase(),
  headers: {
    Authorization: `Bearer ${jwt()}`,
    "Content-Type": "application/json",
  },
  body: body ? (body.startsWith("@") ? readFileSync(body.slice(1), "utf8") : body) : undefined,
});

console.log(res.status);
const text = await res.text();
if (text) {
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}
process.exitCode = res.status < 400 ? 0 : 1;
