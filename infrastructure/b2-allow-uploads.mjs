#!/usr/bin/env node
/**
 * Lets the CarCare website upload files straight to a Backblaze B2 bucket.
 *
 * Uploads go from the browser to storage through a signed URL (ADR-009), so
 * the bucket must say which website may send them: its CORS rules. B2's web
 * interface can only allow downloads, so this sets the rules through the B2
 * API. Run it once, on your own computer, after creating the bucket:
 *
 *   B2_KEY_ID=...  B2_APP_KEY=...  B2_BUCKET=carcare-documents \
 *   WEB_ORIGIN=https://carcare-abc.vercel.app  node infrastructure/b2-allow-uploads.mjs
 *
 * Use the *master* application key (Backblaze → Application Keys): changing a
 * bucket's settings needs more rights than the key the app itself uses. The
 * key is only sent to Backblaze, never stored or printed.
 *
 * Add --dry-run to print the rules without changing anything.
 */

const { B2_KEY_ID, B2_APP_KEY, B2_BUCKET, WEB_ORIGIN } = process.env;
const dryRun = process.argv.includes('--dry-run');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!B2_BUCKET || !WEB_ORIGIN)
  fail('Set B2_BUCKET and WEB_ORIGIN (see the comment at the top of this file).');

let origin;
try {
  origin = new URL(WEB_ORIGIN).origin;
} catch {
  fail(`WEB_ORIGIN must be a web address like https://carcare-abc.vercel.app, not "${WEB_ORIGIN}".`);
}
if (!origin.startsWith('https://') && !origin.startsWith('http://localhost')) {
  fail(`WEB_ORIGIN should start with https:// — got ${origin}.`);
}

const corsRules = [
  {
    corsRuleName: 'carcare-web',
    allowedOrigins: [origin],
    // Upload (PUT), view (GET) and the browser's own checks (HEAD). Nothing else.
    allowedOperations: ['s3_put_object', 's3_get_object', 's3_head_object'],
    // The upload is signed for exactly this header (ADR-009).
    allowedHeaders: ['content-type'],
    exposeHeaders: ['etag'],
    maxAgeSeconds: 3600,
  },
];

if (dryRun) {
  console.log(`Would set these rules on bucket "${B2_BUCKET}":`);
  console.log(JSON.stringify(corsRules, null, 2));
  process.exit(0);
}

if (!B2_KEY_ID || !B2_APP_KEY) fail('Set B2_KEY_ID and B2_APP_KEY (your master application key).');

async function call(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const why = body.message || body.code || 'no details';
    const hint =
      response.status === 401
        ? ' Check B2_KEY_ID and B2_APP_KEY: copy them again from Backblaze → Application Keys.'
        : '';
    fail(`${url.split('/').pop()} failed (${response.status}): ${why}.${hint}`);
  }
  return body;
}

const auth = await call('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
  headers: { Authorization: `Basic ${Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64')}` },
});
const apiUrl = auth.apiInfo?.storageApi?.apiUrl;
if (!apiUrl) fail('Backblaze did not return an API address. Is this the master application key?');

const post = (name, payload) =>
  call(`${apiUrl}/b2api/v3/${name}`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

const { buckets } = await post('b2_list_buckets', { accountId: auth.accountId, bucketName: B2_BUCKET });
const bucket = buckets?.[0];
if (!bucket) fail(`No bucket called "${B2_BUCKET}" on this account. Check the name.`);
if (bucket.bucketType !== 'allPrivate') {
  console.warn(`! The bucket is "${bucket.bucketType}". CarCare expects it Private: receipts are personal.`);
}

const updated = await post('b2_update_bucket', {
  accountId: auth.accountId,
  bucketId: bucket.bucketId,
  corsRules,
});

const rule = updated.corsRules?.find((r) => r.corsRuleName === 'carcare-web');
if (!rule) fail('Backblaze accepted the request but the rule is not on the bucket. Try again.');
console.log(`✓ ${B2_BUCKET} now accepts uploads from ${origin}.`);
console.log(`  S3 endpoint for the app: ${auth.apiInfo.storageApi.s3ApiUrl}`);
