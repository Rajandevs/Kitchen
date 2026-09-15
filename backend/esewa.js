const crypto = require('crypto');

// ESEWA_ENV controls which set of URLs/credentials we use.
// 'test'       -> eSewa's public UAT sandbox (fixed test credentials, safe to commit)
// 'production' -> real money, real credentials from ESEWA_PRODUCT_CODE / ESEWA_SECRET_KEY in .env
const ESEWA_ENV = process.env.ESEWA_ENV || 'test';

const CONFIG = {
  test: {
    formUrl: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    statusUrl: 'https://uat.esewa.com.np/api/epay/transaction/status/',
    productCode: 'EPAYTEST',
    // This is eSewa's published UAT sandbox secret. Their docs render it as
    // "8gBm/:&EnhH.1/q( Input should be text type.)" — the trailing "(" is
    // actually the start of that parenthetical note, not part of the key.
    secretKey: '8gBm/:&EnhH.1/q',
  },
  production: {
    formUrl: 'https://epay.esewa.com.np/api/epay/main/v2/form',
    statusUrl: 'https://epay.esewa.com.np/api/epay/transaction/status/',
    productCode: process.env.ESEWA_PRODUCT_CODE,
    secretKey: process.env.ESEWA_SECRET_KEY,
  },
};

function getConfig() {
  const cfg = CONFIG[ESEWA_ENV];
  if (ESEWA_ENV === 'production' && (!cfg.productCode || !cfg.secretKey)) {
    throw new Error('ESEWA_PRODUCT_CODE and ESEWA_SECRET_KEY must be set in .env for production mode');
  }
  return cfg;
}

function hmacBase64(message, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

// eSewa requires the signed fields joined as "key=value,key=value,..." in the
// exact order listed in signed_field_names.
function buildSignature(fields, secretKey) {
  const fieldNames = fields.signed_field_names.split(',');
  const message = fieldNames.map((name) => `${name}=${fields[name]}`).join(',');
  return hmacBase64(message, secretKey);
}

// Verifies the base64 JSON payload eSewa sends back to success_url.
function verifyResponseSignature(payload, secretKey) {
  if (!payload || !payload.signed_field_names || !payload.signature) return false;
  const expected = buildSignature(payload, secretKey);
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(payload.signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { getConfig, buildSignature, verifyResponseSignature, ESEWA_ENV };
