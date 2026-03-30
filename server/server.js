require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

app.use(cors());
app.use(express.json());
app.use(express.static(ROOT_DIR));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ postSequence: 0, posts: [] }, null, 2), "utf8");
  }
}

function readState() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeState(state) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
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

function validatePostInput(body) {
  const title = normalizeText(body.title, 80);
  const author = normalizeText(body.author, 24) || "匿名垃圾人";
  const category = normalizeText(body.category, 20) || "未分類";
  const summary = normalizeText(body.summary, 140);
  const content = normalizeText(body.content, 4000);
  if (!title || !content) return { error: "標題與內文不能空白" };
  return { value: { title, author, category, summary, content } };
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
    totalFire += Number(post.reactions?.fire || 0);
    totalTrash += Number(post.reactions?.trash || 0);
  }
  return {
    totalPosts: posts.length,
    totalFire,
    totalTrash,
    categories: [...categories.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  };
}

function serializeState(state) {
  const posts = sortPosts(state.posts || []);
  return {
    posts,
    featuredPost: posts.find((post) => post.featured) || posts[0] || null,
    stats: buildStats(posts)
  };
}

function isAdmin(req) {
  return Boolean(ADMIN_PASSWORD) && req.get("X-Admin-Password") === ADMIN_PASSWORD;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/api/posts", (req, res) => {
  res.json({ success: true, ...serializeState(readState()) });
});

app.post("/api/admin/login", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: "管理員密碼錯誤" });
  res.json({ success: true, message: "管理員登入成功" });
});

app.post("/api/admin/reset", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: "管理員密碼錯誤" });
  const cleared = { postSequence: 0, posts: [] };
  writeState(cleared);
  res.json({ success: true, message: "文章已清空", ...serializeState(cleared) });
});

app.post("/api/posts", (req, res) => {
  const state = readState();
  const parsed = validatePostInput(req.body || {});
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
  state.postSequence = Number(state.postSequence || 0) + 1;
  const now = new Date().toISOString();
  const post = {
    id: createPostId(state.postSequence),
    slug: createSlug(parsed.value.title),
    createdAt: now,
    updatedAt: now,
    featured: false,
    reactions: { fire: 0, trash: 0 },
    ...parsed.value
  };
  state.posts = Array.isArray(state.posts) ? state.posts : [];
  state.posts.unshift(post);
  writeState(state);
  res.status(201).json({ success: true, message: "文章發佈成功", post, ...serializeState(state) });
});

app.patch("/api/posts/:postId", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: "管理員密碼錯誤" });
  const state = readState();
  const post = (state.posts || []).find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ success: false, message: "找不到文章" });
  const parsed = validatePostInput(req.body || {});
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
  Object.assign(post, parsed.value, { slug: createSlug(parsed.value.title), updatedAt: new Date().toISOString() });
  writeState(state);
  res.json({ success: true, message: "文章已更新", post, ...serializeState(state) });
});

app.post("/api/posts/:postId/reactions", (req, res) => {
  const state = readState();
  const post = (state.posts || []).find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ success: false, message: "找不到文章" });
  const type = String(req.body?.type || "");
  if (!["fire", "trash"].includes(type)) {
    return res.status(400).json({ success: false, message: "不支援的互動類型" });
  }
  post.reactions[type] += 1;
  writeState(state);
  res.json({ success: true, message: "互動已送出", post, stats: buildStats(state.posts || []) });
});

app.patch("/api/posts/:postId/feature", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: "管理員密碼錯誤" });
  const state = readState();
  const post = (state.posts || []).find((item) => item.id === req.params.postId);
  if (!post) return res.status(404).json({ success: false, message: "找不到文章" });
  for (const item of state.posts) item.featured = false;
  post.featured = true;
  post.updatedAt = new Date().toISOString();
  writeState(state);
  res.json({ success: true, message: "已設為頭條", ...serializeState(state) });
});

app.listen(PORT, () => {
  console.log(`Garbage News server running on http://localhost:${PORT}`);
});
