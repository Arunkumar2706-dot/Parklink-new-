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

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
