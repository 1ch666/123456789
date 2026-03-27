require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const state = {
  current: null,
  last: 0,
  queue: [],
  called: []
};

const sessions = new Set();

app.get('/', (req, res) => {
  res.send('後端伺服器正常運作中');
});

app.get('/api/state', (req, res) => {
  res.json(state);
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: '密碼錯誤'
    });
  }

  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);

  return res.json({
    success: true,
    message: '登入成功',
    token
  });
});

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      success: false,
      message: '未授權，請先登入'
    });
  }

  next();
}

app.post('/api/add-number', requireAuth, (req, res) => {
  state.last += 1;
  state.queue.push(state.last);

  res.json({
    success: true,
    message: '新增成功',
    state
  });
});

app.post('/api/call-next', requireAuth, (req, res) => {
  if (state.queue.length === 0) {
    return res.status(400).json({
      success: false,
      message: '目前沒有等待號碼'
    });
  }

  const next = state.queue.shift();
  state.current = next;
  state.called.push(next);

  res.json({
    success: true,
    message: '叫號成功',
    state
  });
});

app.post('/api/reset', requireAuth, (req, res) => {
  state.current = null;
  state.last = 0;
  state.queue = [];
  state.called = [];

  res.json({
    success: true,
    message: '重置成功',
    state
  });
});

app.post('/api/delete-number', requireAuth, (req, res) => {
  const { number } = req.body;

  if (!state.queue.includes(number)) {
    return res.status(400).json({
      success: false,
      message: '此號碼不在等待中'
    });
  }

  state.queue = state.queue.filter(n => n !== number);

  res.json({
    success: true,
    message: '刪除成功',
    state
  });
});

app.post('/api/restore-number', requireAuth, (req, res) => {
  const { number } = req.body;

  if (state.queue.includes(number) || state.called.includes(number)) {
    return res.status(400).json({
      success: false,
      message: '此號碼已存在，避免重複叫號'
    });
  }

  state.queue.unshift(number);

  if (number > state.last) {
    state.last = number;
  }

  res.json({
    success: true,
    message: '回復成功',
    state
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});