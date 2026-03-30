const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8"
};

const DEMO_POSTS = [
  {
    id: "trash-001",
    slug: "aliens-love-night-market-steak",
    title: "外星人深夜降落士林夜市，只為了學鐵板麵加蛋",
    author: "垃圾線民",
    category: "都市傳說",
    summary: "目擊者表示，飛碟停在捷運站上空三分鐘，最後只帶走黑胡椒醬。",
    content:
      "昨天凌晨兩點，士林夜市上空出現不明強光。多名攤販指出，三名自稱來自『第八象限』的外星人走下飛碟後，沒有攻擊地球，只是反覆詢問鐵板麵能不能雙蛋。攤販最後以加麵不加價平息場面，現場一度被民眾誤認為新型排隊名店。",
    createdAt: "2026-03-28T12:20:00.000Z",
    reactions: { fire: 12, trash: 2 },
    featured: true
  },
  {
    id: "trash-002",
    slug: "office-chair-becomes-ceo",
    title: "公司老闆請假三天，辦公椅暫代 CEO 並通過預算",
    author: "會議室觀察員",
    category: "荒謬職場",
    summary: "與會主管一致認為那張椅子的領導氣場比真人穩定。",
    content:
      "一間新創公司本週召開季度預算會議時，執行長臨時缺席。由於投影機已開、咖啡已到，團隊決定讓他平常坐的黑色辦公椅擺在主位。令人震驚的是，整場會議進行得異常順利，三個部門的預算案全部在十分鐘內通過，還有人主張明年直接讓椅子升任董事長。",
    createdAt: "2026-03-29T04:10:00.000Z",
    reactions: { fire: 21, trash: 4 },
    featured: false
  },
  {
    id: "trash-003",
    slug: "bubble-tea-weather-forecast",
    title: "氣象局改用珍珠奶茶預測天氣，甜度越高降雨機率越大",
    author: "微糖特派",
    category: "假科學",
    summary: "研究團隊強調，半糖是低氣壓，正常糖是梅雨鋒面。",
    content:
      "最新民間研究指出，珍珠奶茶甜度與大氣含水量具有神祕同步性。研究人員把一整排飲料杯放在陽台觀測，發現正常糖當天幾乎都會下雨，無糖則容易吹東北季風。雖然學界尚未承認這套模型，但辦公室同事已決定取消氣象 App，直接以午餐飲料做決策。",
    createdAt: "2026-03-30T02:00:00.000Z",
    reactions: { fire: 35, trash: 6 },
    featured: false
  }
];

const ALLOWED_REACTIONS = new Set(["fire", "trash"]);

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(jsonHeaders)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
  };
}

function resolveCorsOrigin(request, env) {
  const configured = env.CORS_ORIGIN || "*";
  if (configured === "*") return "*";

  const requestOrigin = request.headers.get("Origin");
  if (!requestOrigin) return configured;

  const allowedOrigins = configured.split(",").map((value) => value.trim()).filter(Boolean);
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function createSlug(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled-trash";
}

function createPostId(sequence) {
  return `trash-${String(sequence).padStart(4, "0")}`;
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, maxLength);
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_PASSWORD) && request.headers.get("X-Admin-Password") === env.ADMIN_PASSWORD;
}

function clone(value) {
  return structuredClone(value);
}

function ensureStateShape(data) {
  const next = data && typeof data === "object" ? data : {};
  const posts = Array.isArray(next.posts) ? next.posts : clone(DEMO_POSTS);
  const postSequence = Number.isInteger(next.postSequence) ? next.postSequence : posts.length;

  return {
    posts: posts.map((post) => ({
      id: post.id,
      slug: post.slug || createSlug(post.title),
      title: post.title,
      author: post.author,
      category: post.category || "未分類",
      summary: post.summary || "",
      content: post.content || "",
      createdAt: post.createdAt || new Date().toISOString(),
      featured: Boolean(post.featured),
      reactions: {
        fire: Number(post.reactions?.fire || 0),
        trash: Number(post.reactions?.trash || 0)
      }
    })),
    postSequence
  };
}

function buildStats(posts) {
  const categoryCount = new Map();
  let totalFire = 0;
  let totalTrash = 0;

  for (const post of posts) {
    categoryCount.set(post.category, (categoryCount.get(post.category) || 0) + 1);
    totalFire += post.reactions.fire;
    totalTrash += post.reactions.trash;
  }

  return {
    totalPosts: posts.length,
    totalFire,
    totalTrash,
    categories: [...categoryCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  };
}

function sortPosts(posts) {
  return [...posts].sort((a, b) => {
    if (a.featured !== b.featured) return Number(b.featured) - Number(a.featured);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function serializeState(data) {
  const posts = sortPosts(data.posts);
  return {
    posts,
    stats: buildStats(posts),
    featuredPost: posts[0] || null
  };
}

export default {
  async fetch(request, env) {
    const origin = resolveCorsOrigin(request, env);
    const corsHeaders = buildCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return json({ success: true, service: "garbage-news-api", message: "Garbage News API is running" }, { headers: corsHeaders });
    }

    const id = env.NEWS_BOARD.idFromName("primary");
    const stub = env.NEWS_BOARD.get(id);
    const response = await stub.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);

    return new Response(response.body, { status: response.status, headers });
  }
};

export class NewsBoard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const data = await this.loadData();

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ success: true, service: "garbage-news-api", stats: buildStats(data.posts) });
    }

    if (request.method === "GET" && url.pathname === "/api/posts") {
      return json({ success: true, ...serializeState(data) });
    }

    if (request.method === "POST" && url.pathname === "/api/posts") {
      const body = await readJson(request);
      const title = normalizeText(body.title, 80);
      const author = normalizeText(body.author, 24) || "匿名垃圾人";
      const category = normalizeText(body.category, 20) || "未分類";
      const summary = normalizeText(body.summary, 140);
      const content = normalizeText(body.content, 4000);

      if (!title || !content) {
        return json({ success: false, message: "標題與內文不能空白" }, { status: 400 });
      }

      data.postSequence += 1;
      const post = {
        id: createPostId(data.postSequence),
        slug: createSlug(title),
        title,
        author,
        category,
        summary: summary || content.slice(0, 80),
        content,
        createdAt: new Date().toISOString(),
        featured: false,
        reactions: { fire: 0, trash: 0 }
      };

      data.posts.unshift(post);
      await this.saveData(data);
      return json({ success: true, message: "文章發佈成功", post, ...serializeState(data) }, { status: 201 });
    }

    const reactionMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/reactions$/);
    if (request.method === "POST" && reactionMatch) {
      const post = data.posts.find((item) => item.id === reactionMatch[1]);
      if (!post) return json({ success: false, message: "找不到文章" }, { status: 404 });

      const body = await readJson(request);
      const type = String(body.type || "");
      if (!ALLOWED_REACTIONS.has(type)) {
        return json({ success: false, message: "不支援的互動類型" }, { status: 400 });
      }

      post.reactions[type] += 1;
      await this.saveData(data);
      return json({ success: true, message: "互動已送出", post, stats: buildStats(data.posts) });
    }

    const featureMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/feature$/);
    if (request.method === "PATCH" && featureMatch) {
      if (!isAdmin(request, this.env)) {
        return json({ success: false, message: "缺少管理權限" }, { status: 401 });
      }

      const post = data.posts.find((item) => item.id === featureMatch[1]);
      if (!post) return json({ success: false, message: "找不到文章" }, { status: 404 });

      for (const item of data.posts) item.featured = false;
      post.featured = true;
      await this.saveData(data);
      return json({ success: true, message: "已設為頭條", ...serializeState(data) });
    }

    return json({ success: false, message: "找不到 API 路由" }, { status: 404 });
  }

  async loadData() {
    const stored = await this.state.storage.get("news-state");
    return ensureStateShape(stored);
  }

  async saveData(data) {
    await this.state.storage.put("news-state", data);
  }
}
