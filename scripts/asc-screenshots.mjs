// Upload App Store screenshots via the ASC API.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=… \
//   node scripts/asc-screenshots.mjs <versionLocalizationId> <DISPLAY_TYPE> <file...>
//
// Creates (or reuses) the screenshot set for DISPLAY_TYPE on the given
// appStoreVersionLocalization, then for each file runs Apple's three-step
// flow: reserve (POST appScreenshots) -> execute the returned upload
// operations -> commit with an MD5 checksum. Files upload in argument order,
// which becomes the display order.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createPrivateKey, sign, createHash } from "node:crypto";

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_KEY_PATH;
const [locId, displayType, ...files] = process.argv.slice(2);
if (!KEY_ID || !ISSUER || !KEY_PATH || !locId || !displayType || files.length === 0) {
  console.error(
    "Usage: ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=… node scripts/asc-screenshots.mjs <locId> <DISPLAY_TYPE> <file...>"
  );
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })
  )}`;
  const key = createPrivateKey(readFileSync(KEY_PATH));
  return `${data}.${b64url(sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }))}`;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json;
}

// 1. Find or create the screenshot set for this display type.
const sets = await api(
  "GET",
  `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets?filter%5BscreenshotDisplayType%5D=${displayType}`
);
let setId = sets.data[0]?.id;
if (!setId) {
  const created = await api("POST", "/v1/appScreenshotSets", {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: "appStoreVersionLocalizations", id: locId },
        },
      },
    },
  });
  setId = created.data.id;
}
console.log(`set ${displayType}: ${setId}`);

// 2. Upload each file: reserve -> upload chunks -> commit.
for (const file of files) {
  const bytes = readFileSync(file);
  const reserved = await api("POST", "/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName: basename(file), fileSize: statSync(file).size },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
    },
  });
  const shotId = reserved.data.id;
  for (const op of reserved.data.attributes.uploadOperations) {
    const headers = {};
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const up = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (up.status >= 400) throw new Error(`chunk upload ${up.status} for ${file}`);
  }
  await api("PATCH", `/v1/appScreenshots/${shotId}`, {
    data: {
      type: "appScreenshots",
      id: shotId,
      attributes: {
        uploaded: true,
        sourceFileChecksum: createHash("md5").update(bytes).digest("hex"),
      },
    },
  });
  console.log(`uploaded ${basename(file)} (${bytes.length} bytes)`);
}
console.log("done");
