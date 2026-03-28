require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const ROOT_DIR = path.resolve(__dirname, "..");

app.use(cors());
app.use(express.json());
app.use(express.static(ROOT_DIR));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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

const productMap = new Map(products.map(product => [product.id, product]));

const state = {
  orders: [],
  orderSequence: 0,
  pickupSequence: 0,
  currentPickupNumber: null,
  waitingPickupNumbers: [],
  calledPickupNumbers: []
};

const sessions = new Set();

function formatPickupNumber(sequence) {
  return `A${String(sequence).padStart(3, "0")}`;
}

function formatOrderId(sequence) {
  return `ORD${String(sequence).padStart(4, "0")}`;
}

function createSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function isActiveOrder(order) {
  return order.status !== "done" && order.status !== "cancelled";
}

function sanitizeState() {
  return {
    products,
    orders: state.orders,
    calling: {
      currentPickupNumber: state.currentPickupNumber,
      waitingPickupNumbers: state.waitingPickupNumbers,
      calledPickupNumbers: state.calledPickupNumbers
    },
    stats: buildStats()
  };
}

function buildStats() {
  const validOrders = state.orders.filter(order => order.status !== "cancelled");
  const totalRevenue = validOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const productSales = {};

  validOrders.forEach(order => {
    order.items.forEach(item => {
      if (!productSales[item.productId]) {
        productSales[item.productId] = {
          productId: item.productId,
          name: item.name,
          category: item.category,
          quantity: 0,
          revenue: 0
        };
      }

      productSales[item.productId].quantity += item.quantity;
      productSales[item.productId].revenue += item.subtotal;
    });
  });

  return {
    totalRevenue,
    totalOrders: validOrders.length,
    pendingOrders: state.orders.filter(order => order.status === "pending").length,
    preparingOrders: state.orders.filter(order => order.status === "preparing").length,
    doneOrders: state.orders.filter(order => order.status === "done").length,
    productSales: Object.values(productSales).sort((a, b) => b.quantity - a.quantity)
  };
}

function rebuildWaitingQueue() {
  const current = state.currentPickupNumber;
  state.waitingPickupNumbers = state.orders
    .filter(order => order.needsPickupNumber && isActiveOrder(order))
    .map(order => order.pickupNumber)
    .filter(pickupNumber => pickupNumber && pickupNumber !== current)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function syncCallingAfterOrderChange(order) {
  if (!order.pickupNumber) {
    return;
  }

  if (order.status === "cancelled" || order.status === "done") {
    state.waitingPickupNumbers = state.waitingPickupNumbers.filter(number => number !== order.pickupNumber);
    state.calledPickupNumbers = state.calledPickupNumbers.filter(number => number !== order.pickupNumber);
    if (state.currentPickupNumber === order.pickupNumber) {
      state.currentPickupNumber = null;
    }
    return;
  }

  rebuildWaitingQueue();
}

function ensureAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      success: false,
      message: "未授權，請先登入"
    });
  }

  next();
}

function getOrderOr404(orderId, res) {
  const order = state.orders.find(item => item.orderId === orderId);
  if (!order) {
    res.status(404).json({
      success: false,
      message: "找不到訂單"
    });
    return null;
  }

  return order;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/api/public-state", (req, res) => {
  res.json({
    currentPickupNumber: state.currentPickupNumber,
    waitingPickupNumbers: state.waitingPickupNumbers
  });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "密碼錯誤"
    });
  }

  const token = createSessionToken();
  sessions.add(token);

  return res.json({
    success: true,
    message: "登入成功",
    token
  });
});

app.get("/api/admin-state", ensureAuth, (req, res) => {
  res.json(sanitizeState());
});

app.get("/api/products", ensureAuth, (req, res) => {
  res.json({ products });
});

app.post("/api/orders", ensureAuth, (req, res) => {
  const { items = [], note = "", needsPickupNumber = false } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "請至少選一個品項"
    });
  }

  const normalizedItems = [];

  for (const rawItem of items) {
    const product = productMap.get(rawItem.productId);
    const quantity = Number(rawItem.quantity);

    if (!product || !product.isActive || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "品項資料不正確"
      });
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
    state.waitingPickupNumbers.push(pickupNumber);
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
  if (state.waitingPickupNumbers.length === 0) {
    return res.status(400).json({
      success: false,
      message: "目前沒有等待叫號"
    });
  }

  const nextPickupNumber = state.waitingPickupNumbers.shift();
  state.currentPickupNumber = nextPickupNumber;

  if (!state.calledPickupNumbers.includes(nextPickupNumber)) {
    state.calledPickupNumbers.unshift(nextPickupNumber);
  }

  res.json({
    success: true,
    message: `已叫號 ${nextPickupNumber}`,
    state: sanitizeState()
  });
});

app.post("/api/reset-calling", ensureAuth, (req, res) => {
  state.currentPickupNumber = null;
  state.calledPickupNumbers = [];
  rebuildWaitingQueue();

  res.json({
    success: true,
    message: "叫號佇列已重整",
    state: sanitizeState()
  });
});

app.patch("/api/orders/:orderId/status", ensureAuth, (req, res) => {
  const order = getOrderOr404(req.params.orderId, res);
  if (!order) {
    return;
  }

  const { status } = req.body || {};
  const allowedStatuses = new Set(["pending", "preparing", "done"]);

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({
      success: false,
      message: "狀態不正確"
    });
  }

  if (order.status === "cancelled") {
    return res.status(400).json({
      success: false,
      message: "已取消訂單不能再更新狀態"
    });
  }

  order.status = status;
  syncCallingAfterOrderChange(order);

  res.json({
    success: true,
    message: "訂單狀態已更新",
    order,
    state: sanitizeState()
  });
});

app.post("/api/orders/:orderId/cancel", ensureAuth, (req, res) => {
  const order = getOrderOr404(req.params.orderId, res);
  if (!order) {
    return;
  }

  if (order.status === "cancelled") {
    return res.status(400).json({
      success: false,
      message: "訂單已取消"
    });
  }

  order.status = "cancelled";
  syncCallingAfterOrderChange(order);

  res.json({
    success: true,
    message: "訂單已取消",
    order,
    state: sanitizeState()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
