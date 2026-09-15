const express = require('express');
const db = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function generateOrderNumber() {
  return 'YK-' + Math.floor(1000 + Math.random() * 9000);
}

function uniqueOrderNumber() {
  let orderNumber;
  do {
    orderNumber = generateOrderNumber();
  } while (db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber));
  return orderNumber;
}

// Create an order — must be logged in. This is the "real" order-placing endpoint.
router.post('/', verifyToken, (req, res) => {
  const { items, pickupTime, note } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty' });
  }
  if (!pickupTime) {
    return res.status(400).json({ error: 'Please choose a pickup time' });
  }

  const subtotal = items.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);
  const orderNumber = uniqueOrderNumber();

  const info = db.prepare(`
    INSERT INTO orders (order_number, user_id, items, subtotal, pickup_time, note, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(orderNumber, req.user.id, JSON.stringify(items), subtotal, pickupTime, note || null);

  res.json({
    id: info.lastInsertRowid,
    orderNumber,
    subtotal,
    pickupTime,
    status: 'pending'
  });
});

// A logged-in customer's own order history, for their profile panel
router.get('/mine', verifyToken, (req, res) => {
  const rows = db.prepare(
    `SELECT id, order_number, items, subtotal, pickup_time, note, status, created_at
     FROM orders WHERE user_id = ? ORDER BY created_at DESC`
  ).all(req.user.id);

  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
});

// Admin: every order, newest first
router.get('/', verifyToken, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT orders.id, order_number, items, subtotal, pickup_time, note, status, orders.created_at,
           users.name AS customer_name, users.phone AS customer_phone
    FROM orders
    JOIN users ON users.id = orders.user_id
    ORDER BY orders.created_at DESC
  `).all();

  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
});

// Admin: change order status -> 'pending' | 'made' | 'fulfilled'
router.patch('/:id/status', verifyToken, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'made', 'fulfilled'].includes(status)) {
    return res.status(400).json({ error: 'Status must be pending, made, or fulfilled' });
  }

  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
