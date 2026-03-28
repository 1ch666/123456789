const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8"
};

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

const defaultState = {
  orders: [],
  orderSequence: 0,
  pickupSequence: 0,
  currentPickupNumber: null,
  waitingPickupNumbers: [],
  calledPickupNumbers: [],
  sessions: []
};

function freshRuntimeState() {
  return {
    orders: [],
    orderSequence: 0,
    pickupSequence: 0,
    currentPickupNumber: null,
    waitingPickupNumbers: [],
    calledPickupNumbers: []
  };
}

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(jsonHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function formatPickupNumber(sequence) {
  return `A${String(sequence).padStart(3, "0")}`;
}

function formatOrderId(sequence) {
  return `ORD${String(sequence).padStart(4, "0")}`;
}

function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unauthorized() {
  return {
    success: false,
    message: "請先登入櫃台密碼"
  };
}

function isActiveOrder(order) {
  return order.status !== "done" && order.status !== "cancelled";
}

function clone(value) {
  return structuredClone(value);
}

export default {
  async fetch(request, env) {
    const origin = env.CORS_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return json(
        {
          success: true,
          message: "Drink and ice order API is running"
        },
        { headers: corsHeaders(origin) }
      );
    }

    const id = env.COUNTER.idFromName("primary");
    const stub = env.COUNTER.get(id);
    const response = await stub.fetch(request);
    const headers = new Headers(response.headers);

    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers
    });
  }
};

export class CounterState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const data = await this.loadData();

    if (request.method === "GET" && url.pathname === "/api/public-state") {
      return json({
        currentPickupNumber: data.currentPickupNumber,
        waitingPickupNumbers: data.waitingPickupNumbers
      });
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(request);
      if (body.password !== this.env.ADMIN_PASSWORD) {
        return json({ success: false, message: "櫃台密碼錯誤" }, { status: 401 });
      }

      const token = createSessionToken();
      data.sessions.push(token);
      await this.saveData(data);

      return json({ success: true, message: "登入成功", token });
    }

    if (request.method === "GET" && url.pathname === "/api/admin-state") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      return json(this.sanitizeState(data));
    }

    if (request.method === "POST" && url.pathname === "/api/orders") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      const body = await readJson(request);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) {
        return json({ success: false, message: "請先選擇商品" }, { status: 400 });
      }

      const normalizedItems = [];
      for (const rawItem of items) {
        const product = productMap.get(rawItem.productId);
        const quantity = Number(rawItem.quantity);

        if (!product || !product.isActive || !Number.isInteger(quantity) || quantity <= 0) {
          return json({ success: false, message: "商品或數量不正確" }, { status: 400 });
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

      data.orderSequence += 1;
      let pickupNumber = null;
      if (body.needsPickupNumber) {
        data.pickupSequence += 1;
        pickupNumber = formatPickupNumber(data.pickupSequence);
      }

      const order = {
        orderId: formatOrderId(data.orderSequence),
        pickupNumber,
        needsPickupNumber: Boolean(body.needsPickupNumber),
        note: String(body.note || "").trim(),
        items: normalizedItems,
        totalAmount: normalizedItems.reduce((sum, item) => sum + item.subtotal, 0),
        status: "pending",
        createdAt: new Date().toISOString()
      };

      data.orders.unshift(order);
      this.rebuildWaitingQueue(data);
      await this.saveData(data);

      return json({
        success: true,
        message: "訂單建立成功",
        order,
        state: this.sanitizeState(data)
      }, { status: 201 });
    }

    if (request.method === "POST" && url.pathname === "/api/call-next") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      if (!data.waitingPickupNumbers.length) {
        if (data.currentPickupNumber) {
          return json({
            success: true,
            message: `目前沒有下一號，維持 ${data.currentPickupNumber}`,
            calling: this.sanitizeState(data).calling
          });
        }

        return json({
          success: true,
          message: "目前沒有等待叫號",
          calling: this.sanitizeState(data).calling
        });
      }

      const nextPickupNumber = data.waitingPickupNumbers.shift();
      data.currentPickupNumber = nextPickupNumber;
      data.calledPickupNumbers = [
        nextPickupNumber,
        ...data.calledPickupNumbers.filter((number) => number !== nextPickupNumber)
      ].slice(0, 10);
      await this.saveData(data);

      return json({
        success: true,
        message: `已叫號 ${nextPickupNumber}`,
        calling: this.sanitizeState(data).calling
      });
    }

    if (request.method === "POST" && url.pathname === "/api/recall-current") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      if (!data.currentPickupNumber) {
        return json({ success: false, message: "目前沒有可重叫的號碼" }, { status: 400 });
      }

      data.calledPickupNumbers = [
        data.currentPickupNumber,
        ...data.calledPickupNumbers.filter((number) => number !== data.currentPickupNumber)
      ].slice(0, 10);
      await this.saveData(data);

      return json({
        success: true,
        message: `重新叫號 ${data.currentPickupNumber}`,
        calling: this.sanitizeState(data).calling
      });
    }

    if (request.method === "POST" && url.pathname === "/api/clear-current-pickup") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      if (!data.currentPickupNumber) {
        return json({ success: false, message: "目前沒有號碼可清除" }, { status: 400 });
      }

      const clearedPickupNumber = data.currentPickupNumber;
      data.currentPickupNumber = null;
      await this.saveData(data);

      return json({
        success: true,
        message: `已清除目前叫號 ${clearedPickupNumber}`,
        calling: this.sanitizeState(data).calling
      });
    }

    if (request.method === "POST" && url.pathname === "/api/reset-calling") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      data.currentPickupNumber = null;
      data.calledPickupNumbers = [];
      this.rebuildWaitingQueue(data);
      await this.saveData(data);

      return json({
        success: true,
        message: "叫號狀態已重設",
        calling: this.sanitizeState(data).calling
      });
    }

    if (request.method === "POST" && url.pathname === "/api/reset-daily") {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      Object.assign(data, freshRuntimeState());
      await this.saveData(data);

      return json({
        success: true,
        message: "今日資料已重設",
        state: this.sanitizeState(data)
      });
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/status")) {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      const orderId = url.pathname.split("/")[3];
      const order = data.orders.find((item) => item.orderId === orderId);
      if (!order) {
        return json({ success: false, message: "找不到指定訂單" }, { status: 404 });
      }

      const body = await readJson(request);
      if (!["pending", "preparing", "done"].includes(body.status)) {
        return json({ success: false, message: "狀態不正確" }, { status: 400 });
      }

      order.status = body.status;
      if (body.status === "done" && order.pickupNumber === data.currentPickupNumber) {
        data.currentPickupNumber = null;
      }
      this.rebuildWaitingQueue(data);
      await this.saveData(data);

      return json({
        success: true,
        message: "訂單狀態已更新",
        order,
        state: this.sanitizeState(data)
      });
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/cancel")) {
      if (!this.isAuthorized(request, data)) {
        return json(unauthorized(), { status: 401 });
      }

      const orderId = url.pathname.split("/")[3];
      const order = data.orders.find((item) => item.orderId === orderId);
      if (!order) {
        return json({ success: false, message: "找不到指定訂單" }, { status: 404 });
      }

      if (order.status === "done" || order.status === "cancelled") {
        return json({ success: false, message: "這筆訂單不能取消" }, { status: 400 });
      }

      order.status = "cancelled";
      if (order.pickupNumber === data.currentPickupNumber) {
        data.currentPickupNumber = null;
      }
      this.rebuildWaitingQueue(data);
      await this.saveData(data);

      return json({
        success: true,
        message: "訂單已取消",
        order,
        state: this.sanitizeState(data)
      });
    }

    return json({ success: false, message: "找不到 API 路徑" }, { status: 404 });
  }

  async loadData() {
    const stored = await this.state.storage.get("data");
    return stored ? { ...clone(defaultState), ...stored } : clone(defaultState);
  }

  async saveData(data) {
    await this.state.storage.put("data", data);
  }

  isAuthorized(request, data) {
    const header = request.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return Boolean(token) && data.sessions.includes(token);
  }

  rebuildWaitingQueue(data) {
    const current = data.currentPickupNumber;
    data.waitingPickupNumbers = data.orders
      .filter((order) => order.needsPickupNumber && isActiveOrder(order))
      .map((order) => order.pickupNumber)
      .filter((pickupNumber) => pickupNumber && pickupNumber !== current)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  }

  sanitizeState(data) {
    return {
      products,
      orders: data.orders,
      calling: {
        currentPickupNumber: data.currentPickupNumber,
        waitingPickupNumbers: data.waitingPickupNumbers,
        calledPickupNumbers: data.calledPickupNumbers
      },
      stats: this.buildStats(data)
    };
  }

  buildStats(data) {
    const validOrders = data.orders.filter((order) => order.status !== "cancelled");
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
      pendingOrders: data.orders.filter((order) => order.status === "pending").length,
      preparingOrders: data.orders.filter((order) => order.status === "preparing").length,
      doneOrders: data.orders.filter((order) => order.status === "done").length,
      productSales: [...productSales.values()].sort((a, b) => b.quantity - a.quantity)
    };
  }
}
