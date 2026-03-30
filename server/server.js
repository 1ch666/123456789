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

app.use(cors());
app.use(express.json());
app.use(express.static(ROOT_DIR));

function createSlug(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled-trash";
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, maxLength);
}

function createPostId(sequence) {
  return `trash-${String(sequence).padStart(4, "0")}`;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const seed = { postSequence: DEMO_POSTS.length, posts: DEMO_POSTS };
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), "utf8");
  }
}

function readState() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return {
    postSequence: Number.isInteger(parsed.postSequence) ? parsed.postSequence : DEMO_POSTS.length,
    posts: Array.isArray(parsed.posts) ? parsed.posts : [...DEMO_POSTS]
  };
}

function writeState(state) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
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
  const posts = sortPosts(state.posts);
  return {
    posts,
    featuredPost: posts[0] || null,
    stats: buildStats(posts)
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/api/health", (req, res) => {
  const state = readState();
  res.json({ success: true, service: "garbage-news-api", stats: buildStats(state.posts) });
});

app.get("/api/posts", (req, res) => {
  const state = readState();
  res.json({ success: true, ...serializeState(state) });
});

app.post("/api/posts", (req, res) => {
  const state = readState();
  const title = normalizeText(req.body?.title, 80);
  const author = normalizeText(req.body?.author, 24) || "匿名垃圾人";
  const category = normalizeText(req.body?.category, 20) || "未分類";
  const summary = normalizeText(req.body?.summary, 140);
  const content = normalizeText(req.body?.content, 4000);

  if (!title || !content) {
    return res.status(400).json({ success: false, message: "標題與內文不能空白" });
  }

  state.postSequence += 1;
  const post = {
    id: createPostId(state.postSequence),
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

  state.posts.unshift(post);
  writeState(state);

  return res.status(201).json({ success: true, message: "文章發佈成功", post, ...serializeState(state) });
});

app.post("/api/posts/:postId/reactions", (req, res) => {
  const state = readState();
  const post = state.posts.find((item) => item.id === req.params.postId);
  if (!post) {
    return res.status(404).json({ success: false, message: "找不到文章" });
  }

  const type = String(req.body?.type || "");
  if (!["fire", "trash"].includes(type)) {
    return res.status(400).json({ success: false, message: "不支援的互動類型" });
  }

  post.reactions[type] += 1;
  writeState(state);

  res.json({ success: true, message: "互動已送出", post, stats: buildStats(state.posts) });
});

app.patch("/api/posts/:postId/feature", (req, res) => {
  if (!ADMIN_PASSWORD || req.get("X-Admin-Password") !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "缺少管理權限" });
  }

  const state = readState();
  const post = state.posts.find((item) => item.id === req.params.postId);
  if (!post) {
    return res.status(404).json({ success: false, message: "找不到文章" });
  }

  for (const item of state.posts) item.featured = false;
  post.featured = true;
  writeState(state);

  res.json({ success: true, message: "已設為頭條", ...serializeState(state) });
});

app.listen(PORT, () => {
  console.log(`Garbage News server running on http://localhost:${PORT}`);
});
