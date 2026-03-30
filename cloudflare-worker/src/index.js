const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

const EMPTY_STATE = {
  postSequence: 0,
  posts: []
};

const ALLOWED_REACTIONS = new Set(["fire", "trash"]);

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
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
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, maxLength);
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

function isAdmin(request, env) {
  return Boolean(env.ADMIN_PASSWORD) && request.headers.get("X-Admin-Password") === env.ADMIN_PASSWORD;
}

function normalizePost(post) {
  return {
    id: post.id,
    slug: post.slug || createSlug(post.title),
    title: post.title,
    author: post.author || "匿名垃圾人",
    category: post.category || "未分類",
    summary: post.summary || "",
    content: post.content || "",
    createdAt: post.createdAt || new Date().toISOString(),
    updatedAt: post.updatedAt || post.createdAt || new Date().toISOString(),
    featured: Boolean(post.featured),
    reactions: {
      fire: Number(post.reactions?.fire || 0),
      trash: Number(post.reactions?.trash || 0)
    }
  };
}

function ensureStateShape(data) {
  const source = data && typeof data === "object" ? data : EMPTY_STATE;
  const posts = Array.isArray(source.posts) ? source.posts.map(normalizePost) : [];
  return {
    postSequence: Number.isInteger(source.postSequence) ? source.postSequence : posts.length,
    posts
  };
}

function sortPosts(posts) {
  return [...posts].sort((a, b) => {
    if (a.featured !== b.featured) return Number(b.featured) - Number(a.featured);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function buildStats(posts) {
  const categories = new Map();
  let totalFire = 0;
  let totalTrash = 0;
  for (const post of posts) {
    categories.set(post.category, (categories.get(post.category) || 0) + 1);
    totalFire += post.reactions.fire;
    totalTrash += post.reactions.trash;
  }
  return {
    totalPosts: posts.length,
    totalFire,
    totalTrash,
    categories: [...categories.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  };
}

function serializeState(data) {
  const posts = sortPosts(data.posts);
  return {
    posts,
    featuredPost: posts.find((post) => post.featured) || posts[0] || null,
    stats: buildStats(posts)
  };
}

function validatePostInput(body) {
  const title = normalizeText(body.title, 80);
  const author = normalizeText(body.author, 24) || "匿名垃圾人";
  const category = normalizeText(body.category, 20) || "未分類";
  const summary = normalizeText(body.summary, 140);
  const content = normalizeText(body.content, 4000);
  if (!title || !content) return { error: "標題與內文不能空白" };
  return { value: { title, author, category, summary, content } };
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
      return json({ success: true, service: "garbage-news-api" }, { headers: corsHeaders });
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

    if (request.method === "GET" && url.pathname === "/api/posts") {
      return json({ success: true, ...serializeState(data) });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      if (!isAdmin(request, this.env)) return json({ success: false, message: "管理員密碼錯誤" }, { status: 401 });
      return json({ success: true, message: "管理員登入成功" });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/reset") {
      if (!isAdmin(request, this.env)) return json({ success: false, message: "管理員密碼錯誤" }, { status: 401 });
      const cleared = { ...EMPTY_STATE };
      await this.saveData(cleared);
      return json({ success: true, message: "文章已清空", ...serializeState(cleared) });
    }

    if (request.method === "POST" && url.pathname === "/api/posts") {
      const parsed = validatePostInput(await readJson(request));
      if (parsed.error) return json({ success: false, message: parsed.error }, { status: 400 });
      data.postSequence += 1;
      const now = new Date().toISOString();
      const post = { id: createPostId(data.postSequence), slug: createSlug(parsed.value.title), createdAt: now, updatedAt: now, featured: false, reactions: { fire: 0, trash: 0 }, ...parsed.value };
      data.posts.unshift(post);
      await this.saveData(data);
      return json({ success: true, message: "文章發佈成功", post, ...serializeState(data) }, { status: 201 });
    }

    const editMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (editMatch && request.method === "PATCH") {
      if (!isAdmin(request, this.env)) return json({ success: false, message: "管理員密碼錯誤" }, { status: 401 });
      const post = data.posts.find((item) => item.id === editMatch[1]);
      if (!post) return json({ success: false, message: "找不到文章" }, { status: 404 });
      const parsed = validatePostInput(await readJson(request));
      if (parsed.error) return json({ success: false, message: parsed.error }, { status: 400 });
      Object.assign(post, parsed.value, { slug: createSlug(parsed.value.title), updatedAt: new Date().toISOString() });
      await this.saveData(data);
      return json({ success: true, message: "文章已更新", post, ...serializeState(data) });
    }

    const reactionMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/reactions$/);
    if (reactionMatch && request.method === "POST") {
      const post = data.posts.find((item) => item.id === reactionMatch[1]);
      if (!post) return json({ success: false, message: "找不到文章" }, { status: 404 });
      const type = String((await readJson(request)).type || "");
      if (!ALLOWED_REACTIONS.has(type)) return json({ success: false, message: "不支援的互動類型" }, { status: 400 });
      post.reactions[type] += 1;
      await this.saveData(data);
      return json({ success: true, message: "互動已送出", post, stats: buildStats(data.posts) });
    }

    const featureMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/feature$/);
    if (featureMatch && request.method === "PATCH") {
      if (!isAdmin(request, this.env)) return json({ success: false, message: "管理員密碼錯誤" }, { status: 401 });
      const post = data.posts.find((item) => item.id === featureMatch[1]);
      if (!post) return json({ success: false, message: "找不到文章" }, { status: 404 });
      for (const item of data.posts) item.featured = false;
      post.featured = true;
      post.updatedAt = new Date().toISOString();
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
