require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

const app = express();
const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

if (!ADMIN_PASSWORD) {
  throw new Error("Missing ADMIN_PASSWORD in environment");
}

app.use(cors());
app.use(express.json());
app.use(express.static(ROOT_DIR));

const products = [
  { id: "drink-black-tea", name: "紅茶", category: "drink", price: 35, isActive: true },
  { id: "drink-green-tea", name: "綠茶", category: "drink", price: 35, isActive: true },
  { id: "drink-milk-tea", name: "奶茶", category: "drink", price: 50, isActive: true },
  { id: "drink-boba-milk-tea", name: "珍珠奶茶", category: "drink", price: 60, isActive: true },
  { id: "drink-lemon-black-tea", name: "檸檬紅茶", category: "drink", price: 55, isActive: true },
  { id: "ice-mango", name: "芒果冰", category: "ice", price: 90, isActive: true },
  { id: "ice-strawberry", name: "草莓冰", category: "ice", price: 95, isActive: true },
  { id: "ice-red-bean", name: "紅豆牛奶冰", category: "ice", price: 80, isActive: true },
  { id: "ice-mixed-fruit", name: "綜合水果冰", category: "ice", price: 100, isActive: true }
];

const productMap = new Map(products.map((product) => [product.id, product]));
const sessions = new Map();

const state = {
  orders: [],
  orderSequence: 0,
  pickupSequence: 0,
  currentPickupNumber: null,
  waitingPickupNumbers: [],
  calledPickupNumbers: [],
  businessDate: currentBusinessDate()
};

function currentBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatPickupNumber(sequence) {
  return `A${String(sequence).padStart(3, "0")}`;
}

function formatOrderId(sequence) {
  return `ORD${String(sequence).padStart(4, "0")}`;
}

function createSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createSession() {
  const token = createSessionToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function isActiveOrder(order) {
  return order.status !== "done" && order.status !== "cancelled";
}

function rebuildWaitingQueue() {
  const current = state.currentPickupNumber;
  state.waitingPickupNumbers = state.orders
    .filter((order) => order.needsPickupNumber && isActiveOrder(order))
    .map((order) => order.pickupNumber)
    .filter((pickupNumber) => pickupNumber && pickupNumber !== current)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function buildStats() {
  const validOrders = state.orders.filter((order) => order.status !== "cancelled");
  const productSales = new Map();

  for (const order of validOrders) {
    for (const item of order.items) {
      const existing = productSales.get(item.productId) || {
        productId: item.productId,
        name: item.name,
        category: item.category,
        quantity: 0,
        revenue: 0
      };

      existing.quantity += item.quantity;
      existing.revenue += item.subtotal;
      productSales.set(item.productId, existing);
    }
  }

  return {
    totalRevenue: validOrders.reduce((sum, order) => sum + order.totalAmount, 0),
    totalOrders: validOrders.length,
    pendingOrders: state.orders.filter((order) => order.status === "pending").length,
    preparingOrders: state.orders.filter((order) => order.status === "preparing").length,
    doneOrders: state.orders.filter((order) => order.status === "done").length,
    productSales: [...productSales.values()].sort((a, b) => b.quantity - a.quantity)
  };
}

function sanitizeState() {
  return {
    products,
    orders: state.orders,
    businessDate: state.businessDate,
    calling: {
      currentPickupNumber: state.currentPickupNumber,
      waitingPickupNumbers: state.waitingPickupNumbers,
      calledPickupNumbers: state.calledPickupNumbers
    },
    stats: buildStats()
  };
}

function resetDailyState() {
  state.businessDate = currentBusinessDate();
  state.orders = [];
  state.orderSequence = 0;
  state.pickupSequence = 0;
  state.currentPickupNumber = null;
  state.waitingPickupNumbers = [];
  state.calledPickupNumbers = [];
}

function ensureCurrentBusinessDay() {
  const today = currentBusinessDate();
  if (state.businessDate !== today) {
    resetDailyState();
  }
}

function ensureAuth(req, res, next) {
  pruneExpiredSessions();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token || !sessions.has(token)) {
    return res.status(401).json({ success: false, message: "請先登入櫃台密碼" });
  }

  next();
}

function getOrderOr404(orderId, res) {
  const order = state.orders.find((item) => item.orderId === orderId);
  if (!order) {
    res.status(404).json({ success: false, message: "找不到指定訂單" });
    return null;
  }
  return order;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/api/public-state", (req, res) => {
  ensureCurrentBusinessDay();
  res.json({
    currentPickupNumber: state.currentPickupNumber,
    waitingPickupNumbers: state.waitingPickupNumbers
  });
});

app.post("/api/login", (req, res) => {
  ensureCurrentBusinessDay();
  pruneExpiredSessions();
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "櫃台密碼錯誤" });
  }

  const session = createSession();
  res.json({
    success: true,
    token: session.token,
    expiresAt: new Date(session.expiresAt).toISOString(),
    message: "登入成功"
  });
});

app.get("/api/admin-state", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  res.json(sanitizeState());
});

app.post("/api/orders", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  const { items = [], note = "", needsPickupNumber = false } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "請先選擇商品" });
  }

  const normalizedItems = [];
  for (const rawItem of items) {
    const product = productMap.get(rawItem.productId);
    const quantity = Number(rawItem.quantity);

    if (!product || !product.isActive || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: "商品或數量不正確" });
    }

    normalizedItems.push({
      productId: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      quantity,
      subtotal: product.price * quantity
    });
  }

  state.orderSequence += 1;
  let pickupNumber = null;

  if (needsPickupNumber) {
    state.pickupSequence += 1;
    pickupNumber = formatPickupNumber(state.pickupSequence);
  }

  const order = {
    orderId: formatOrderId(state.orderSequence),
    pickupNumber,
    needsPickupNumber: Boolean(needsPickupNumber),
    note: String(note || "").trim(),
    items: normalizedItems,
    totalAmount: normalizedItems.reduce((sum, item) => sum + item.subtotal, 0),
    status: "pending",
    createdAt: new Date().toISOString()
  };

  state.orders.unshift(order);
  rebuildWaitingQueue();

  res.status(201).json({
    success: true,
    message: "訂單建立成功",
    order,
    state: sanitizeState()
  });
});

app.post("/api/call-next", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  if (state.waitingPickupNumbers.length === 0) {
    if (state.currentPickupNumber) {
      return res.json({
        success: true,
        message: `目前沒有下一號，維持 ${state.currentPickupNumber}`,
        calling: sanitizeState().calling
      });
    }

    return res.json({
      success: true,
      message: "目前沒有等待叫號",
      calling: sanitizeState().calling
    });
  }

  const nextPickupNumber = state.waitingPickupNumbers.shift();
  state.currentPickupNumber = nextPickupNumber;
  state.calledPickupNumbers = [
    nextPickupNumber,
    ...state.calledPickupNumbers.filter((number) => number !== nextPickupNumber)
  ].slice(0, 10);

  res.json({ success: true, message: `已叫號 ${nextPickupNumber}`, calling: sanitizeState().calling });
});

app.post("/api/recall-current", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  if (!state.currentPickupNumber) {
    return res.status(400).json({ success: false, message: "目前沒有可重叫的號碼" });
  }

  state.calledPickupNumbers = [
    state.currentPickupNumber,
    ...state.calledPickupNumbers.filter((number) => number !== state.currentPickupNumber)
  ].slice(0, 10);

  res.json({
    success: true,
    message: `重新叫號 ${state.currentPickupNumber}`,
    calling: sanitizeState().calling
  });
});

app.post("/api/clear-current-pickup", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  if (!state.currentPickupNumber) {
    return res.status(400).json({ success: false, message: "目前沒有號碼可清除" });
  }

  const clearedPickupNumber = state.currentPickupNumber;
  state.currentPickupNumber = null;

  res.json({
    success: true,
    message: `已清除目前叫號 ${clearedPickupNumber}`,
    calling: sanitizeState().calling
  });
});

app.post("/api/reset-calling", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  state.currentPickupNumber = null;
  state.calledPickupNumbers = [];
  rebuildWaitingQueue();

  res.json({ success: true, message: "叫號狀態已重設", calling: sanitizeState().calling });
});

app.post("/api/reset-daily", ensureAuth, (req, res) => {
  resetDailyState();

  res.json({
    success: true,
    message: "今日資料已重設",
    state: sanitizeState()
  });
});

app.patch("/api/orders/:orderId/status", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  const order = getOrderOr404(req.params.orderId, res);
  if (!order) return;

  const { status } = req.body || {};
  const allowedStatuses = new Set(["pending", "preparing", "done"]);
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ success: false, message: "狀態不正確" });
  }

  order.status = status;
  if (status === "done" && order.pickupNumber === state.currentPickupNumber) {
    state.currentPickupNumber = null;
  }
  rebuildWaitingQueue();

  res.json({ success: true, message: "訂單狀態已更新", order, state: sanitizeState() });
});

app.post("/api/orders/:orderId/cancel", ensureAuth, (req, res) => {
  ensureCurrentBusinessDay();
  const order = getOrderOr404(req.params.orderId, res);
  if (!order) return;

  if (order.status === "done" || order.status === "cancelled") {
    return res.status(400).json({ success: false, message: "這筆訂單不能取消" });
  }

  order.status = "cancelled";
  if (order.pickupNumber === state.currentPickupNumber) {
    state.currentPickupNumber = null;
  }
  rebuildWaitingQueue();

  res.json({ success: true, message: "訂單已取消", order, state: sanitizeState() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
