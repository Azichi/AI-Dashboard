// App.js
// ==================================================
// ================ CHUNK: IMPORTS ==================
// ==================================================
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import "./App.css";

// ==================================================
// ============== CHUNK: DEMO CONFIG =================
// ==================================================
// Static scripted demo: zero network calls, zero OpenAI.
// Set `REACT_APP_DEMO_MODE=true` at build-time to force demo mode.
const DEMO_MODE = String(process.env.REACT_APP_DEMO_MODE || "false").toLowerCase() === "true";
const DEMO_LABEL = DEMO_MODE
  ? "Static demo (no live AI on this deployment)."
  : "Live mode (uses your local backend).";
const DEMO_STORE_KEY = "cv_demo_store_v1";

const DEMO_CHATS = [
  {
    id: "cv-demo-1",
    title: "File summary + action plan",
    messages: [
      { role: "assistant", content: "Static demo. No OpenAI calls. Type anything to step through scripted replies." }
    ],
    reply_queue: [
      "Demo summary: Revenue up, churn flat, support tickets spiked after last release.\n\nNext actions:\n1) Audit top ticket tags by release\n2) Hotfix plan\n3) Outreach to at-risk users\n4) Add monitoring/alerts",
      "Draft message (demo):\n\nTeam, priorities:\n- P0 Audit support issues by tag + release today\n- P1 Hotfix plan within 48h\n- P1 CS outreach this week\n- P2 Monitoring + alerting\n\nReply with blockers + owners by EOD."
    ]
  },
  {
    id: "cv-demo-2",
    title: "Generate code + explain",
    messages: [
      { role: "assistant", content: "Ask for code and I’ll respond with a demo snippet." }
    ],
    reply_queue: [
      "Demo FastAPI endpoint:\n\n```python\nfrom fastapi import FastAPI, UploadFile, File\n\napp = FastAPI()\n\n@app.post('/summarize')\nasync def summarize(file: UploadFile = File(...)):\n    data = await file.read()\n    text = data.decode('utf-8', errors='ignore')\n    summary = (text[:400] + '...') if len(text) > 400 else text\n    return {'filename': file.filename, 'bytes': len(data), 'summary': summary}\n```\n",
      "Security gotchas (demo): validate type/size, rate-limit, avoid logging raw content, store uploads safely, strict CORS."
    ]
  },
  {
    id: "cv-demo-3",
    title: "Tool-style workflow",
    messages: [
      { role: "assistant", content: "Tool-style workflow (scripted) showing the kinds of outputs the real system produces." }
    ],
    reply_queue: [
      "Demo: cleaned `sales_raw.csv` (12,418 rows). Fixes: removed duplicates, filled nulls, normalized dates.",
      "Top findings (demo):\n- Weekends underperform → shift promo budget to Fri evening\n- One region has higher refunds → audit fulfillment partner SLA\n- Two products drive most growth → expand adjacent SKUs"
    ]
  }
];

function nowIso() { return new Date().toISOString(); }
function uuid() {
  try { return crypto.randomUUID(); }
  catch { return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now(); }
}

function buildDefaultStore() {
  const now = nowIso();
  const project = { id: "demo", name: "CV Demo", model: "demo", system_prompt: "", created_at: now, updated_at: now };
  const chats = DEMO_CHATS.map((c) => ({
    id: c.id || uuid(),
    title: c.title || "Demo chat",
    created_at: now,
    updated_at: now,
    messages: (c.messages || []).map((m) => ({ ...m, ts: m.ts || now })),
    reply_queue: (c.reply_queue || []).slice()
  }));
  return { project, chats };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(DEMO_STORE_KEY);
    if (!raw) return buildDefaultStore();
    const parsed = JSON.parse(raw);
    if (!parsed?.project || !Array.isArray(parsed?.chats)) return buildDefaultStore();
    return parsed;
  } catch {
    return buildDefaultStore();
  }
}

function saveStore(store) {
  try { localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store)); } catch {}
}

function findChat(store, cid) {
  return (store.chats || []).find((c) => c.id === cid) || null;
}


// App.js
// ==================================================
// ============ CHUNK: UTIL — API CLIENT ============
// ==================================================
async function demoApi(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const url = new URL(String(path), "http://demo.local");
  const p = url.pathname;

  const store = loadStore();
  const pid = store.project.id;

  // Projects: list
  if (p === "/projects" && method === "GET") {
    return { projects: [store.project] };
  }

  // Projects: create (in demo, treat as "rename" and keep same id)
  if (p === "/projects" && method === "POST") {
    const name = String(opts.body?.name || "CV Demo").trim() || "CV Demo";
    store.project = { ...store.project, name, updated_at: nowIso() };
    saveStore(store);
    return { project: store.project };
  }

  // Projects: update fields (THIS fixes model-change crash)
  const mProj = p.match(/^\/projects\/([^/]+)$/);
  if (mProj) {
    const reqPid = decodeURIComponent(mProj[1]);
    if (reqPid !== pid) throw new Error("Demo: unknown project");

    if (method === "PUT") {
      store.project = { ...store.project, ...(opts.body || {}), updated_at: nowIso() };
      saveStore(store);
      return { project: store.project };
    }

    if (method === "DELETE") {
      const fresh = buildDefaultStore();
      saveStore(fresh);
      return { ok: true };
    }
  }

  // Chats list/create
  const mChats = p.match(/^\/projects\/([^/]+)\/chats$/);
  if (mChats) {
    if (decodeURIComponent(mChats[1]) !== pid) throw new Error("Demo: unknown project");
    if (method === "GET") return { chats: store.chats || [] };
    if (method === "POST") {
      const now = nowIso();
      const chat = {
        id: uuid(),
        title: (opts.body?.title ? String(opts.body.title) : "New chat"),
        created_at: now,
        updated_at: now,
        messages: [{ role: "assistant", content: "Static demo: load an example chat to see scripted flows.", ts: now }],
        reply_queue: []
      };
      store.chats = [chat, ...(store.chats || [])];
      saveStore(store);
      return { chat };
    }
  }

  // Chat delete
  const mChatDel = p.match(/^\/projects\/([^/]+)\/chats\/([^/]+)$/);
  if (mChatDel && method === "DELETE") {
    if (decodeURIComponent(mChatDel[1]) !== pid) throw new Error("Demo: unknown project");
    const cid = decodeURIComponent(mChatDel[2]);
    store.chats = (store.chats || []).filter(c => c.id !== cid);
    saveStore(store);
    return { ok: true };
  }

  // Chat rename
  const mChatRename = p.match(/^\/projects\/([^/]+)\/chats\/([^/]+)\/rename$/);
  if (mChatRename && method === "POST") {
    if (decodeURIComponent(mChatRename[1]) !== pid) throw new Error("Demo: unknown project");
    const cid = decodeURIComponent(mChatRename[2]);
    const title = String(opts.body?.title || "Chat").trim() || "Chat";
    store.chats = (store.chats || []).map(c => c.id === cid ? { ...c, title, updated_at: nowIso() } : c);
    saveStore(store);
    return { ok: true };
  }

  // Chat message
  const mMsg = p.match(/^\/projects\/([^/]+)\/chats\/([^/]+)\/message$/);
  if (mMsg && method === "POST") {
    if (decodeURIComponent(mMsg[1]) !== pid) throw new Error("Demo: unknown project");
    const chat = findChat(store, decodeURIComponent(mMsg[2]));
    if (!chat) throw new Error("Demo: unknown chat");

    const content = opts.body?.content ? String(opts.body.content) : "";
    const now = nowIso();

    if (content) chat.messages = [...(chat.messages || []), { role: "user", content, ts: now }];

    const queued = (chat.reply_queue || []).shift();
    const reply = queued || "Static demo: open an example chat to see scripted capability flows.";
    chat.messages = [...(chat.messages || []), { role: "assistant", content: reply, ts: nowIso() }];
    chat.updated_at = nowIso();

    saveStore(store);
    return { reply };
  }

  return { ok: true, demo: true };
}

async function api(path, opts = {}) {
  if (DEMO_MODE) return demoApi(path, opts);

  const base = String(process.env.REACT_APP_API_BASE || "").replace(/\/+$/, "");
  const url = (base ? base : "") + path;
  const method = (opts.method || "GET").toUpperCase();
  const headers = { ...(opts.headers || {}) };

  const init = { method, headers };
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else {
      init.body = JSON.stringify(opts.body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || res.statusText || `HTTP ${res.status}`);
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}




// ==================================================
// ================ CHUNK: APP STATE ================
// ==================================================
export default function App() {
  const [projects, setProjects] = useState([]);
  const [pid, setPid] = useState(null);
  const [ephemeralPid, setEphemeralPid] = useState(null);

  const [chats, setChats] = useState([]);
  const [cid, setCid] = useState(null);
  const [chat, setChat] = useState({ messages: [] });

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState("dashboard"); // 'dashboard' | 'chat'
  const [fileCount, setFileCount] = useState(0);

  const [showFilesModal, setShowFilesModal] = useState(false);
  const [rootFiles, setRootFiles] = useState([]);
  const filesUploadRef = useRef(null);

  const [recState, setRecState] = useState("idle");
  const mediaRef = useRef(null);

  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    (localStorage.getItem("sidebarVisible") ?? "true") === "true"
  );
  const [compact, setCompact] = useState(() =>
    (localStorage.getItem("compact") ?? "false") === "true"
  );

  const [showMenu, setShowMenu] = useState(null);      // project ⋯
  const [showChatMenu, setShowChatMenu] = useState(null); // chat ⋯

  const [isStreaming, setIsStreaming] = useState(false);

  const [reactions, setReactions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("reactions") || "{}"); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem("reactions", JSON.stringify(reactions)); }, [reactions]);

  const [chatTitleOverrides, setChatTitleOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("chatTitles") || "{}"); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem("chatTitles", JSON.stringify(chatTitleOverrides)); }, [chatTitleOverrides]);

  const endRef = useRef(null);

  const MODEL_OPTIONS = [
    { label: "GPT-5 — Auto",          value: "gpt-5-auto" },
    { label: "GPT-5 — Instant",       value: "gpt-5-instant" },
    { label: "GPT-5 — Thinking mini", value: "gpt-5-thinking-mini" },
    { label: "GPT-5 — Thinking",      value: "gpt-5-thinking" },
    { label: "GPT-5 — Pro",           value: "gpt-5-pro" },
    { label: "GPT-5 Mini",            value: "gpt-5-mini" },
    { label: "──────────",            value: "__sep__" },
    { label: "GPT-4o",                value: "gpt-4o" },
    { label: "GPT-4.1",               value: "gpt-4.1" },
    { label: "o3",                    value: "o3" },
    { label: "o4-mini",               value: "o4-mini" },
    { label: "---------- Local (Ollama) ----------", value: "__sep__" },
    { label: "Llama 3.1 (local via Ollama)", value: "ollama:llama3.1" },
  ];

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const [showEditInstr, setShowEditInstr] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");

  useEffect(() => { localStorage.setItem("theme", theme); }, [theme]);
  useEffect(() => { localStorage.setItem("sidebarVisible", String(sidebarVisible)); }, [sidebarVisible]);
  useEffect(() => { localStorage.setItem("compact", String(compact)); }, [compact]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);
  useEffect(() => { refreshProjects(); }, []);

// ==================================================
// ======== CHUNK: MENU — OUTSIDE CLICK CLOSE ========
// ==================================================
useEffect(() => {
  function handleOutside(e) {
    // Safe = the actual dropdown panels OR the ⋯ button containers.
    // NOT safe = the rest of the row, so clicking another chat row closes menus.
    const safe = e.target.closest(".dropdown, .project-options, .chat-options");
    if (!safe) {
      setShowMenu(null);
      setShowChatMenu(null);
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      setShowMenu(null);
      setShowChatMenu(null);
    }
  }

  // Run on click in bubble phase so inner handlers fire first.
  document.addEventListener("click", handleOutside, { capture: false });
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("click", handleOutside, { capture: false });
    document.removeEventListener("keydown", onKey);
  };
}, []);



  // ==================================================
  // =========== CHUNK: UTIL — DATE/MARKDOWN ==========
  // ==================================================
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleString();
  }
  function isSameDay(a, b) {
    if (!a || !b) return false;
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear() &&
           da.getMonth() === db.getMonth() &&
           da.getDate() === db.getDate();
  }
  function fmtDay(s) {
    const d = new Date(s);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  }

  function MD({ text }) {
    if (!text) return null;
    const markdown = String(text);

    function extractText(node) {
      if (node == null) return "";
      if (typeof node === "string") return node;
      if (Array.isArray(node)) return node.map(extractText).join("");
      if (typeof node === "object" && node.props) return extractText(node.props.children);
      return "";
    }

    return (
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            a: ({ href, children, ...props }) => (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            ),
            pre: ({ children }) => {
              const codeText = extractText(children);
              return (
                <pre>
                  <button
                    className="copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      try { navigator.clipboard.writeText(codeText); } catch {}
                    }}
                    title="Copy code"
                  >
                    Copy
                  </button>
                  {children}
                </pre>
              );
            },
            code: ({ inline, className, children, ...props }) => {
              if (inline) return <code className={"inline-code " + (className || "")} {...props}>{children}</code>;
              return <code className={className || ""} {...props}>{children}</code>;
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    );
  }

  const inputRef = useRef(null);
  function autoResize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }


// ==================================================
// ============ CHUNK: PROJECTS — CRUD ==============
// ==================================================
async function refreshProjects(selectId) {
  const res = await api("/projects");
  setProjects(res.projects || []);
  let chosen = selectId || pid;
  if (!chosen && res.projects?.length) chosen = res.projects[0].id;
  if (!chosen) {
    const created = await api("/projects", { method: "POST", body: { name: "Default" } });
    chosen = created.project.id;
    const list = await api("/projects");
    setProjects(list.projects || []);
  }
  setPid(chosen);

  try {
    if (chosen) {
      const clist = await api(`/projects/${chosen}/chats`);
      if (!clist.chats || clist.chats.length === 0) {
        await api(`/projects/${chosen}/chats`, { method: "POST", body: { title: "New chat" } });
      }
    }
  } catch {}
}

function newProject() {
  setNewProjectName(""); setShowNewProject(true);
}

async function createProjectFromModal() {
  const name = (newProjectName || "").trim();
  if (!name) { setShowNewProject(false); return; }
  const res = await api("/projects", { method: "POST", body: { name } });
  setShowNewProject(false); setNewProjectName("");
  await refreshProjects(res.project?.id);
  setView("dashboard");
}

// 🔧 allow targeting a specific project id (defaults to current pid)
async function updateProject(fields, projectId = pid) {
  if (!projectId) return;
  const res = await api(`/projects/${projectId}`, { method: "PUT", body: fields });
  setProjects((prev) => prev.map((p) => p.id === projectId ? res.project : p));
  // If we renamed the active project, keep pid as-is but UI will re-read from projects[]
}

async function renameProjectPrompt(projectId) {
  const proj = projects.find(p => p.id === projectId) || projects.find(p => p.id === pid);
  if (!proj) return;
  const current = proj.name || "Project";
  const next = window.prompt("Rename project", current);
  if (next == null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === current) return;

  try {
    // Optimistic update
    setProjects(prev => prev.map(p => p.id === proj.id ? { ...p, name: trimmed } : p));
    await updateProject({ name: trimmed }, proj.id);
  } catch (err) {
    // Revert on error and show message
    await refreshProjects(proj.id);
    alert("Rename failed: " + String(err));
  }
}

async function deleteProject(projectId) {
  const targetId = projectId || pid;
  if (!targetId) return;
  const proj = projects.find(p => p.id === targetId);
  if (!window.confirm(`Delete project “${proj?.name || "Project"}” and all its chats?`)) return;

  await api(`/projects/${targetId}`, { method: "DELETE" });

  // If we deleted the active project, clear pid before refreshing
  if (pid === targetId) setPid(null);
  await refreshProjects();
  setView("dashboard");
}


// ==================================================
// ===== CHUNK: CHATS — LOAD, SELECT, SEND ==========
// ==================================================
useEffect(() => {
  if (!pid) return;
  (async () => {
    // Do NOT bounce the view to dashboard anymore (prevents flicker).
    // Also, if we're in chat view with an ephemeral chat (cid === null), don't auto-select.
    const preserveEphemeral = (view === "chat" && cid == null);

    let res = await api(`/projects/${pid}/chats`);
    if (!res.chats || res.chats.length === 0) {
      await api(`/projects/${pid}/chats`, { method: "POST", body: { title: "New chat" } });
      res = await api(`/projects/${pid}/chats`);
    }

    const withTitles = (res.chats || []).map(c => ({
      ...c, title: chatTitleOverrides[`${pid}:${c.id}`] || c.title
    }));
    setChats(withTitles);

    if (!preserveEphemeral && !cid) {
      setCid(withTitles?.[0]?.id || null);
      setChat({ messages: [] });
    }

    setRootFiles([]);
    await recountFiles();
  })();
  // include 'view' and 'cid' so we correctly preserve the ephemeral chat
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pid, view, cid, chatTitleOverrides]);

useEffect(() => {
  if (!pid || !cid) return;

  // If we have a live assistant typing placeholder, don't stomp it with a fresh fetch.
  const hasTypingPlaceholder =
    (chat?.messages || []).some(m => m.role === "assistant" && m.content === "");
  if (hasTypingPlaceholder) return;

  (async () => {
    const res = await api(`/projects/${pid}/chats`);
    const list = (res.chats || []).map(c => ({
      ...c, title: chatTitleOverrides[`${pid}:${c.id}`] || c.title
    }));
    const found = list.find((c) => c.id === cid) || { messages: [] };
    setChats(list);
    setChat(found);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  })();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [cid, pid, chatTitleOverrides]);

  async function loadChatsAndSelect(selectId, projectId = pid) {
    const res = await api(`/projects/${projectId}/chats`);
    const list = (res.chats || []).map(c => ({
      ...c, title: chatTitleOverrides[`${projectId}:${c.id}`] || c.title
    }));
    setChats(list);
    setCid(selectId || (list?.[0]?.id ?? null));
  }

  async function deleteChat(id) {
    if (!pid || !id) return;
    if (!window.confirm("Delete this chat?")) return;
    await api(`/projects/${pid}/chats/${id}`, { method: "DELETE" });
    await loadChatsAndSelect(null);
  }

  async function clearChat() {
    if (!pid) return;
    const res = await api(`/projects/${pid}/chats`, { method: "POST", body: { title: "New chat" } });
    await loadChatsAndSelect(res.chat.id);
  }

  function streamIntoLastAssistant(fullText) {
    setIsStreaming(true);
    let i = 0;
    function nextDelay(ch) {
      if (ch === " ") return 0;
      if (ch === "\n") return 15;
      if (",.;:!?".includes(ch)) return 20;
      return 5;
    }
    function tick() {
      setChat((c) => {
        const msgs = [...(c.messages || [])];
        for (let k = msgs.length - 1; k >= 0; k--) {
          if (msgs[k].role === "assistant") {
            msgs[k] = { ...msgs[k], content: fullText.slice(0, i + 3) };
            break;
          }
        }
        return { ...c, messages: msgs };
      });
      if (i >= fullText.length) { setIsStreaming(false); return; }
      const ch = fullText[i];
      i += 3;
      const jitter = Math.floor(Math.random() * 6) - 3;
      const d = Math.max(0, nextDelay(ch) + jitter);
      setTimeout(tick, d);
    }
    setTimeout(tick, 0);
  }

  // ==================================================
  // ================== CHUNK: NEW CHAT ===============
  // ==================================================
  async function newChat() {
    if (!pid) return;
    const res = await api(`/projects/${pid}/chats`, { method: "POST", body: { title: "New chat" } });
    await loadChatsAndSelect(res.chat.id, pid);
    setView("chat");
    setEphemeralPid(null);
  }

// ==================================================
// =================== CHUNK: SEND ==================
// ==================================================
async function send() {
  if (!input.trim() || loading) return;

  // Use the locked project if we came from the logo; otherwise current pid.
  const targetPid = cid ? pid : (ephemeralPid || pid);
  if (!targetPid) return;

  // Ensure a real chat exists, but DO NOT fetch the chat list yet.
  let activeChatId = cid;
  if (!activeChatId) {
    const created = await api(`/projects/${targetPid}/chats`, {
      method: "POST",
      body: { title: "New chat" }
    });
    activeChatId = created.chat.id;

    // Align UI to the project of the created chat.
    if (pid !== targetPid) setPid(targetPid);

    // Select that chat immediately and show the chat view.
    setCid(activeChatId);
    setView("chat");
    setEphemeralPid(null);

    // Make sure the new chat exists in the sidebar right away.
    setChats((prev) => {
      if (prev.some(x => x.id === activeChatId)) return prev;
      const now = new Date().toISOString();
      return [{ id: activeChatId, title: "New chat", created_at: now, updated_at: now }, ...prev];
    });

    // Reset local chat display in case something lingers.
    setChat({ messages: [] });
  }

  const content = input.trim();
  setInput("");
  requestAnimationFrame(() => {
    const el = document.querySelector("textarea.input");
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  });

  // Optimistic user + assistant typing placeholder (so it shows immediately)
  const optimisticUser = { role: "user", content, ts: new Date().toISOString() };
  const optimisticAssistant = { role: "assistant", content: "", ts: new Date().toISOString() };
  setChat((c) => ({ ...c, messages: [...(c.messages || []), optimisticUser, optimisticAssistant] }));

  setLoading(true);
  try {
    const res = await api(`/projects/${targetPid}/chats/${activeChatId}/message`, {
      method: "POST",
      body: { content }
    });
    // Stream into the existing assistant placeholder
    streamIntoLastAssistant(res.reply || "");

    // AFTER the server responds, reconcile titles/timestamps from backend
    await loadChatsAndSelect(activeChatId, targetPid);
  } catch (e) {
    setChat((c) => ({
      ...c,
      messages: [...(c.messages || []), { role: "assistant", content: "Error: " + String(e), ts: new Date().toISOString() }]
    }));
  } finally {
    setLoading(false);
  }
}


  // ==================================================
  // ===== CHUNK: CHAT HELPERS — TITLES & RENAME ======
  // ==================================================
  function getChatTitle(c) {
    return chatTitleOverrides[`${pid}:${c.id}`] || c.title;
  }

  async function renameChat(c) {
    const current = getChatTitle(c);
    const next = window.prompt("Rename chat", current);
    if (next == null) return;
    const trimmed = next.trim() || current;
    try {
      await api(`/projects/${pid}/chats/${c.id}/rename`, { method: "POST", body: { title: trimmed } });
      await loadChatsAndSelect(c.id, pid);
    } catch {
      const key = `${pid}:${c.id}`;
      setChatTitleOverrides((prev) => ({ ...prev, [key]: trimmed }));
      setChats((prev) => prev.map(x => x.id === c.id ? { ...x, title: trimmed } : x));
    }
  }

  // ==================================================
  // =========== CHUNK: INPUT — KEY HANDLER ===========
  // ==================================================
  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

// App.js
  // ==================================================
  // ================= CHUNK: FILE OPS ================
  // ==================================================
  async function recountFiles() {
    // CV demo: no backend files
    if (DEMO_MODE) { setFileCount(0); return; }
    if (!pid) return;

    async function countAll(path = "") {
      const r = await api(`/projects/${pid}/files/list?path=${encodeURIComponent(path)}`);
      const items = r.entries || [];
      let files = 0; const dirs = [];
      for (const e of items) {
        if (e.type === "file") files++;
        else if (e.type === "dir") dirs.push(e.name);
      }
      for (const d of dirs) files += await countAll(path ? `${path}/${d}` : d);
      return files;
    }
    try { setFileCount(await countAll("")); } catch {}
  }

  async function listRootFiles() {
    // CV demo: show empty files list, don’t call backend
    if (DEMO_MODE) { setRootFiles([]); return; }
    if (!pid) return;

    const r = await api(`/projects/${pid}/files/list?path=`);
    setRootFiles(r.entries || []);
  }

  async function uploadToRoot(files) {
    if (DEMO_MODE) { alert("CV demo: file upload disabled."); return; }
    if (!pid || !files?.length) return;

    const fd = new FormData();
    fd.append("path", "");
    fd.append("file", files[0]);
    await api(`/projects/${pid}/files/upload`, { method: "POST", body: fd });
    await listRootFiles();
    await recountFiles();
  }

  async function downloadFile(path) {
    if (DEMO_MODE) { alert("CV demo: file download disabled."); return; }

    const url = `/projects/${pid}/files/download?path=${encodeURIComponent(path)}`;
    const res = await fetch(url);
    if (!res.ok) return alert("Download failed");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = path.split("/").pop();
    a.click();
    URL.revokeObjectURL(a.href);
  }


// App.js
  // ==================================================
  // =================== CHUNK: VOICE =================
  // ==================================================
  async function toggleRec() {
    if (DEMO_MODE) { alert("CV demo: voice disabled."); return; }

    if (recState === "idle") {
      if (!navigator.mediaDevices?.getUserMedia) { alert("Mic not available"); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "recording.webm");
        try {
          const res = await fetch("/voice/stt", { method: "POST", body: fd });
          const j = await res.json();
          if (j.text) setInput((prev) => {
            const next = (prev ? prev + " " : "") + j.text;
            requestAnimationFrame(() => autoResize(inputRef.current));
            return next;
          });
        } catch { alert("STT error"); }
        setRecState("idle");
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRef.current = mr;
      setRecState("recording");
      mr.start();
    } else {
      mediaRef.current?.stop();
    }
  }


  // ==================================================
  // =========== CHUNK: MEMO — CURRENT PROJECT ========
  // ==================================================
  const currentProject =
    React.useMemo(() => projects.find((p) => p.id === pid) || null, [projects, pid]);

  const layoutClasses = [
    "layout",
    theme === "light" ? "theme-light" : "theme-dark",
    sidebarVisible ? "" : "sidebar-hidden",
    compact ? "compact" : ""
  ].filter(Boolean).join(" ");

  function TypingDots() {
    const [dots, setDots] = useState(".");
    useEffect(() => {
      const id = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 350);
      return () => clearInterval(id);
    }, []);
    return <span style={{ opacity: 0.9 }}>{`typing${dots}`}</span>;
  }

  function ReactionBar({ msgKey }) {
    const value = reactions[msgKey] || null;
    const setValue = (v) => {
      setReactions((prev) => {
        const next = { ...prev };
        next[msgKey] = prev[msgKey] === v ? null : v;
        return next;
      });
    };
    const btnStyle = (active) => ({
      fontSize: 13, border: "1px solid var(--border)",
      background: active ? "rgba(16,163,127,.12)" : "transparent",
      color: "var(--text)", padding: "2px 8px", borderRadius: 999, cursor: "pointer"
    });
    return (
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button style={btnStyle(value === "up")} onClick={() => setValue("up")} title="Good answer">👍</button>
        <button style={btnStyle(value === "down")} onClick={() => setValue("down")} title="Not helpful">👎</button>
      </div>
    );
  }

  // ==================================================
  // ========== CHUNK: HANDLER — LOGO → EPHEMERAL =====
  // ==================================================
  function goHomeEphemeral() {
    // Lock the current project so Send uses it.
    setEphemeralPid(pid);

    // Open a blank (non-existent) chat view.
    setCid(null);
    setChat({ messages: [] });
    setView("chat");
  }

// ==================================================
// ============== CHUNK: RENDER — SHELL =============
// ==================================================
return (
  <div className={layoutClasses + (sidebarVisible ? "" : " sidebar-collapsed")}>
    {/* Sidebar */}
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo" onClick={goHomeEphemeral} title="Home" style={{cursor:"pointer", userSelect:"none"}}>
          🌌
        </div>

        <button
          className="btn icon"
          title={sidebarVisible ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setSidebarVisible((v) => !v)}
        >
          {sidebarVisible ? "⟨" : "⟩"}
        </button>
      </div>

      {sidebarVisible && (
        <div className="sidebar-list">
          <button className="btn list-item" onClick={newChat}>＋ New chat</button>
          <button className="btn list-item" onClick={newProject}>＋ New project</button>

          <div className="projects">
            {projects.map((p) => (
              <div key={p.id} className={"project-block " + (p.id === pid ? "active" : "")}>
                <div className="project-row" onClick={() => setPid(p.id)}>
                  <span className="project-name">{p.name}</span>
                  <div className="project-options">
                    <button
                      className="icon"
                      title="Project options"
                      onClick={(e) => { e.stopPropagation(); setShowMenu(showMenu === p.id ? null : p.id); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >⋯</button>
                    {showMenu === p.id && (
                      <div
                        className="dropdown"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(null); renameProjectPrompt(p.id); }}>
                          Rename Project
                        </button>
                        <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); setShowMenu(null); deleteProject(p.id); }}>
                          Delete Project
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {p.id === pid && (
                  <div className="chat-nested">
                    {(chats || []).map((c) => (
                      <div
                        key={c.id}
                        className={"list-item nested " + (c.id === cid && view === "chat" ? "active" : "")}
                        // ✅ Use onClick (bubble), not onMouseDownCapture (capture).
                        // This lets the ⋯ button stopPropagation cleanly.
                        onClick={(e) => {
                          // If the click originated in the ⋯ button or its dropdown, do not select.
                          if (e.target.closest(".chat-options, .dropdown")) return;

                          setEphemeralPid(null);
                          setCid(c.id);
                          setView("chat");
                        }}
                        style={{ position: "relative" }}
                      >
                        💬 {getChatTitle(c)}

                        <div
                          className="chat-options"
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "50%",
                            transform: "translateY(-50%)",
                            zIndex: 2
                          }}
                          // ✅ Stop events in *capture* so the row never sees them.
                          onMouseDownCapture={(e) => e.stopPropagation()}
                          onPointerDownCapture={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="icon"
                            title="Chat options"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowChatMenu(showChatMenu === c.id ? null : c.id);
                            }}
                          >
                            ⋯
                          </button>

                          {showChatMenu === c.id && (
                            <div
                              className="dropdown"
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowChatMenu(null);
                                  renameChat(c);
                                }}
                              >
                                Rename Chat
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowChatMenu(null);
                                  deleteChat(c.id);
                                }}
                              >
                                Delete Chat
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {chats.length === 0 && (<div className="list-item nested muted">No chats</div>)}
                  </div>
                )}

              </div>
            ))}
          </div>
        </div>
      )}
    </aside>


      {/* Main */}
      <main className="main">
        <header className="topbar">
          <div className="left">
            <div className="title">{currentProject?.name || "Project"}</div>
            <div className="tabs" style={{ marginLeft: 10 }}>
              <select
                className="tab"
                value={currentProject?.model || "gpt-5-auto"}
                onChange={(e) => updateProject({ model: e.target.value })}
                title="Select model"
              >
                {MODEL_OPTIONS.map(opt => opt.value === "__sep__"
                  ? <option key="sep" disabled>──────────</option>
                  : <option key={opt.value} value={opt.value}>{opt.label}</option>
                )}
              </select>
            </div>
          </div>

          <div className="right">
            <button className="btn small ghost" onClick={() => setCompact((v) => !v)} title="Toggle compact mode">
              {compact ? "Compact ✓" : "Compact"}
            </button>
            <button className="btn small ghost" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} title="Toggle theme">
              {theme === "light" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </div>
        </header>

        {view === "dashboard" && (
          <div className="dash">
            <div className="dash-cards">
              <div className="dash-card">
                <div className="row">
                  <h3>Files</h3>
                  <div className="dash-stat">
                    {fileCount} files
                    <button
                      className="btn small ghost"
                      style={{ marginLeft: 8 }}
                      title="Change Instructions"
                      onClick={() => { setSystemPromptDraft(currentProject?.system_prompt || ""); setRootDraft(currentProject?.root || ""); setShowEditInstr(true); }}
                    >
                      Change Instructions
                    </button>
                  </div>
                </div>

                <div className="dash-actions" style={{ marginTop: 8 }}>
                  <button className="btn small" title="Project files" onClick={async () => { await listRootFiles(); setShowFilesModal(true); }}>
                    Files
                  </button>
                </div>
              </div>

              <div className="dash-card">
                <div className="row">
                  <h3>Chats</h3>
                  <div className="dash-actions">
                    <button className="btn small" onClick={newChat}>New Chat</button>
                  </div>
                </div>
                <div className="dash-list">
                  {(chats || []).map((c) => (
                    <div key={c.id} className="dash-item" onClick={() => { setCid(c.id); setView("chat"); }}>
                      <span>💬 {getChatTitle(c)}</span>
                      <span className="dash-stat">{new Date(c.updated_at || c.created_at || Date.now()).toLocaleString()}</span>
                    </div>
                  ))}
                  {chats.length === 0 && <div className="dash-stat">No chats</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {view === "chat" && (
          <>
            <section className="chat"
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadToRoot([f]); }}
            >
              {(chat.messages || []).map((m, i, arr) => {
                const prev = i > 0 ? arr[i-1] : null;
                const showDay = !prev || !isSameDay(prev.ts, m.ts);
                const msgKey = `${pid}:${cid}:${i}`;
                const isAssistant = m.role === "assistant";
                const isTypingPlaceholder = isAssistant && !m.content;
                return (
                  <React.Fragment key={i}>
                    {showDay && m.ts && (
                      <div className="row" style={{justifyContent:"center"}}>
                        <div style={{ fontSize:12, color:"var(--muted)", padding:"2px 10px", border:"1px solid var(--border)", borderRadius:999, background:"var(--panel-2)" }}>
                          {fmtDay(m.ts)}
                        </div>
                      </div>
                    )}
                    <div className={"row " + (m.role === "user" ? "me" : "ai")}>
                      <div className={"bubble " + (isAssistant ? "assistant" : "user") }>
                        {isAssistant && (
                          <button className="copy" title="Copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(m.content); }}>⧉</button>
                        )}
                        <div className="content">
                          {isTypingPlaceholder && loading ? <TypingDots/> : <MD text={m.content} />}
                        </div>
                        {isAssistant && !isTypingPlaceholder && <ReactionBar msgKey={msgKey} />}
                        {m.ts && <div className="ts">{fmtDate(m.ts)}</div>}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={endRef} />
            </section>

            <footer className="inputbar">
              <button className={"mic " + (recState === "recording" ? "on" : "")} title={recState === "recording" ? "Stop" : "Voice input"} onClick={toggleRec}>🎙</button>
              <textarea
                ref={inputRef}
                className="input"
                value={input}
                placeholder="Type a message…"
                rows={1}
                onChange={(e) => { setInput(e.target.value); autoResize(e.target); }}
                onFocus={(e) => autoResize(e.target)}
                onKeyDown={onKeyDown}
              />
              <button className="send" onClick={send} disabled={loading || !input.trim()}>{loading ? "Sending..." : "Send"}</button>
            </footer>
          </>
        )}

        {showNewProject && (
          <div className="overlay" onClick={() => setShowNewProject(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Create Project</div>
                <button className="modal-close" onClick={() => setShowNewProject(false)}>✕</button>
              </div>
              <div className="modal-body">
                <label style={{display:"block", fontSize:12, color:"var(--muted)", marginBottom:6}}>
                  Project root path (blank = default workspace)
                </label>
                <input
                  type="text"
                  value={rootDraft}
                  onChange={(e) => setRootDraft(e.target.value)}
                  placeholder="e.g. C:\\Users\\Azi\\Desktop\\Coding Projects\\Sandbox Project"
                />
                <div style={{height: 10}} />
                <label>
                  Project name
                  <input type="text" placeholder="My project" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
                </label>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={createProjectFromModal}>Create Project</button>
              </div>
            </div>
          </div>
        )}

        {showEditInstr && (
          <div className="overlay" onClick={() => setShowEditInstr(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Project Instructions</div>
                <button className="modal-close" onClick={() => setShowEditInstr(false)}>✕</button>
              </div>
              <div className="modal-body">
                <textarea value={systemPromptDraft} onChange={(e) => setSystemPromptDraft(e.target.value)} placeholder="System prompt for this project…" />
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={async () => { await updateProject({ system_prompt: systemPromptDraft, root: rootDraft }); setShowEditInstr(false); }}>Save</button>
              </div>
            </div>
          </div>
        )}

        {showFilesModal && (
          <div
            className="overlay"
            onClick={() => setShowFilesModal(false)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={async (e) => {
              e.preventDefault();
              const files = e.dataTransfer.files;
              if (files?.length) { await uploadToRoot(files); }
            }}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{width: 720, maxWidth: "92vw"}}>
              <div className="modal-header" style={{alignItems:"center"}}>
                <div className="modal-title">Project files</div>
                <div style={{marginLeft:"auto", display:"flex", gap:8}}>
                  <button className="btn" onClick={() => filesUploadRef.current?.click()} title="Add files">Add files</button>
                  <button className="modal-close" onClick={() => setShowFilesModal(false)}>✕</button>
                </div>
              </div>

              <div className="modal-body" style={{paddingTop:4}}>
                <input
                  ref={filesUploadRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const files = e.target.files;
                    e.target.value = "";
                    if (files?.length) await uploadToRoot(files);
                  }}
                />

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--panel-2)",
                    maxHeight: "60vh",
                    overflowY: "auto"
                  }}
                >
                  {rootFiles.length === 0 && (
                    <div style={{padding:16, color:"var(--muted)"}}>
                      No files yet. Click <b>Add files</b> or drop files here.
                    </div>
                  )}

                  {rootFiles.map((f) => {
                    const ext = (f.name.split(".").pop() || "").toLowerCase();
                    const icon = f.type === "dir" ? "📁" : "📄";
                    const tag =
                      f.type === "dir" ? "Folder" :
                      ext === "py" ? "Python" :
                      ext === "js" ? "JavaScript" :
                      ext === "ts" ? "TypeScript" :
                      ext === "md" ? "File" :
                      ext === "json" ? "JSON" :
                      ext === "css" ? "CSS" :
                      ext === "html" ? "HTML" : "File";

                    const fullPath = f.name;
                    return (
                      <div
                        key={fullPath}
                        className="file-row"
                        style={{ padding: "10px 12px", cursor: "pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}
                        onClick={() => downloadFile(fullPath)}
                        title="Click to download"
                      >
                        <div style={{display:"flex", alignItems:"center", gap:10}}>
                          <span style={{opacity:.9}}>{icon}</span>
                          <div>
                            <div style={{fontWeight:600}}>{f.name}</div>
                            <div style={{fontSize:12, color:"var(--muted)"}}>{tag}</div>
                          </div>
                        </div>

                        {f.type !== "dir" && (
                          <div style={{display:"flex", gap:8}}>
                            <button className="btn small" onClick={(e) => { e.stopPropagation(); downloadFile(fullPath); }}>Download</button>
                            <button
                              className="btn small"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!window.confirm(`Delete ${f.name}?`)) return;
                                await api(`/projects/${pid}/files/delete`, { method: "POST", body: { path: fullPath } });
                                await listRootFiles();
                                await recountFiles();
                              }}
                            >Delete</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{marginTop:10, fontSize:12, color:"var(--muted)"}}>
                  Tip: you can also drag & drop files anywhere in this modal.
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
