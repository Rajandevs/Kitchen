require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const email = 'admin@yetikitchen.com';
const password = 'ChangeMe123!';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

if (existing) {
  console.log('An admin account already exists for:', email);
} else {
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run('Kitchen Admin', email, null, passwordHash, 'admin');

  console.log('Admin account created:');
  console.log('  email:   ', email);
  console.log('  password:', password);
  console.log('Log in at /admin.html and change this password later.');
}
