const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const dbPath = path.join(__dirname, 'data.json');

// Initialize empty DB if it doesn't exist
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({
    vehicles: [],
    bookings: []
  }, null, 2));
}

// GET entire DB state
app.get('/api/sync', (req, res) => {
  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read DB' });
  }
});

// POST to update entire DB state or specific collections
app.post('/api/sync', (req, res) => {
  try {
    const currentStateStr = fs.readFileSync(dbPath, 'utf8');
    let currentState = JSON.parse(currentStateStr);
    
    // Merge updates
    const updates = req.body;
    currentState = { ...currentState, ...updates };
    
    fs.writeFileSync(dbPath, JSON.stringify(currentState, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write DB' });
  }
});

// In-memory OTP store (keyed by phone number)
const otpStore = {};

// Send OTP — generates and stores a 6-digit OTP
app.post('/api/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit phone number required' });
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[phone] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 }; // 5 min expiry

  // ── In production, integrate Twilio/MSG91 here ──
  console.log(`\n📱 OTP for +91 ${phone}: ${otp}\n`);

  res.json({ success: true, message: `OTP sent to +91 ${phone}` });
});

// Verify OTP
app.post('/api/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  const record = otpStore[phone];
  if (!record) return res.status(400).json({ error: 'No OTP sent to this number' });
  if (Date.now() > record.expiresAt) {
    delete otpStore[phone];
    return res.status(400).json({ error: 'OTP expired. Request a new one.' });
  }
  if (record.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });

  delete otpStore[phone]; // One-time use
  res.json({ success: true, message: 'OTP verified successfully' });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
