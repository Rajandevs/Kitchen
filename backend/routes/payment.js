const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { getConfig, buildSignature, verifyResponseSignature } = require('../esewa');

const router = express.Router();

const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || APP_URL).replace(/\/$/, '');

// Step 1 — customer already placed the order (POST /api/orders) and chose
// "Pay with eSewa". We build the signed form fields for THAT order's amount.
// The amount is decided here, server-side, from the order we already saved —
// never trust an amount coming from the browser.
router.post('/esewa/initiate/:orderId', verifyToken, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .get(req.params.orderId, req.user.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment_status === 'paid') {
    return res.status(400).json({ error: 'This order is already paid' });
  }

  const cfg = getConfig();

  // transaction_uuid must be unique per *attempt*. Using order number + timestamp
  // means a customer can retry after a failed/abandoned payment without collisions.
  const transaction_uuid = `${order.order_number}-${Date.now()}`;
  const amount = order.subtotal;

  const fields = {
    amount: String(amount),
    tax_amount: '0',
    total_amount: String(amount),
    transaction_uuid,
    product_code: cfg.productCode,
    product_service_charge: '0',
    product_delivery_charge: '0',
    success_url: `${APP_URL}/api/payment/esewa/success`,
    failure_url: `${APP_URL}/api/payment/esewa/failure`,
    signed_field_names: 'total_amount,transaction_uuid,product_code',
  };
  fields.signature = buildSignature(fields, cfg.secretKey);

  db.prepare('UPDATE orders SET transaction_uuid = ?, payment_method = ? WHERE id = ?')
    .run(transaction_uuid, 'esewa', order.id);

  res.json({ formUrl: cfg.formUrl, fields });
});

// Step 2 — eSewa redirects the customer's browser here after they pay.
// This is a GET the customer's browser makes, so we can't rely on cookies/session
// here in general — we identify the order purely from the signed payload.
router.get('/esewa/success', async (req, res) => {
  try {
    const raw = Buffer.from(req.query.data, 'base64').toString('utf-8');
    const decoded = JSON.parse(raw);
    const cfg = getConfig();

    // 1) Verify eSewa's signature on the redirect payload itself.
    if (!verifyResponseSignature(decoded, cfg.secretKey)) {
      return res.redirect(`${FRONTEND_URL}/?payment=invalid`);
    }

    const order = db.prepare('SELECT * FROM orders WHERE transaction_uuid = ?')
      .get(decoded.transaction_uuid);
    if (!order) return res.redirect(`${FRONTEND_URL}/?payment=unknown`);

    // 2) Never mark paid off the redirect alone — ask eSewa directly via the
    // status check API, which is the authoritative source of truth.
    const statusUrl = `${cfg.statusUrl}?product_code=${encodeURIComponent(cfg.productCode)}`
      + `&total_amount=${encodeURIComponent(order.subtotal)}`
      + `&transaction_uuid=${encodeURIComponent(decoded.transaction_uuid)}`;

    const statusRes = await fetch(statusUrl);
    const statusData = await statusRes.json();

    if (statusData.status === 'COMPLETE') {
      db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
      return res.redirect(`${FRONTEND_URL}/?payment=success&order=${encodeURIComponent(order.order_number)}`);
    }

    return res.redirect(`${FRONTEND_URL}/?payment=pending&order=${encodeURIComponent(order.order_number)}`);
  } catch (err) {
    console.error('eSewa success handler error:', err);
    return res.redirect(`${FRONTEND_URL}/?payment=error`);
  }
});

// eSewa sends the customer here on failure/cancel. Nothing to verify — the
// order simply stays unpaid and the customer can retry or pay at pickup.
router.get('/esewa/failure', (req, res) => {
  res.redirect(`${FRONTEND_URL}/?payment=failed`);
});

module.exports = router;
