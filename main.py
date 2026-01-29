## // ==================================================
## // =============== CHUNK: IMPORTS ===================
## // ==================================================
## // main.py — Projects/Chats/Files + Delete + Full File Ops + Voice STT/TTS
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from pathlib import Path
from datetime import datetime
import os, json, requests, uuid, shutil, mimetypes, io, re


# main.py
### // ==================================================
### // =============== CHUNK: APP + CONFIG ==============
### // ==================================================
app = FastAPI()

def _env_flag(name: str, default: bool = False) -> bool:
    v = os.environ.get(name, "")
    if v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "y", "on")
# --- Load API key from .env / environment ---
def _load_dotenv():
    try:
        override = _env_flag("DOTENV_OVERRIDE", default=False)
        candidates = [Path(__file__).parent / ".env", Path(".env")]
        for p in candidates:
            if not p.exists():
                continue
            pairs = []
            for raw in p.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k:
                    pairs.append((k, v))

            # Allow setting DOTENV_OVERRIDE in the .env itself (handy on Windows when a
            # stale global env var is set).
            for k, v in pairs:
                if k == "DOTENV_OVERRIDE" and str(v).strip().lower() in ("1", "true", "yes", "y", "on"):
                    override = True
                    break

            for k, v in pairs:
                if k == "DOTENV_OVERRIDE":
                    continue
                if k == "PUBLIC_DEMO":
                    if v != "":
                        os.environ[k] = v
                    continue
                if override or (k not in os.environ) or (os.environ.get(k, "") == ""):
                    os.environ[k] = v
    except Exception:
        pass

# Don’t even load keys if this is the CV demo backend
_load_dotenv()

PUBLIC_DEMO = _env_flag("PUBLIC_DEMO", default=False)
api_key = "" if PUBLIC_DEMO else os.environ.get("OPENAI_API_KEY", "")
DEMO_REPLY = (
    "This is a demo build. Live AI calls are disabled because no API key is configured.\n"
    "To enable live responses, set OPENAI_API_KEY in .env and restart the server."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================================================
# ================= CHUNK: HEALTH ==================
# ==================================================
# Put this anywhere after `app = FastAPI()` exists in main.py
@app.get("/health")
async def health():
    return {"ok": True}



### // ==================================================
### // =============== CHUNK: LEGACY CHAT ===============
### // ==================================================
class ChatBody(BaseModel):
    messages: Optional[List[Dict[str, str]]] = None
    message: Optional[str] = None
    model: Optional[str] = None   # allow override


@app.post("/chat")
def chat(req: ChatBody):
    if req.messages:
        msgs = req.messages
    elif req.message:
        msgs = [{"role": "user", "content": req.message}]
    else:
        raise HTTPException(400, "Missing 'messages' or 'message'.")

    # use request override or fallback to a safe default
    model = req.model or "gpt-5"
    reply = llm_chat(msgs, {"model": model})
    return {"response": reply}




# main.py
# // ==================================================
# // =============== CHUNK: LLM PROVIDER ==============
# // ==================================================
OPENAI_MODEL_MAP = {
    "gpt-5-auto":           "gpt-5",
    "gpt-5-instant":        "gpt-5",
    "gpt-5-thinking":       "gpt-5",
    "gpt-5-thinking-mini":  "gpt-5-mini",
    "gpt-5-pro":            "gpt-5",
    "gpt-5-mini":           "gpt-5-mini",
    "gpt-5-nano":           "gpt-5-nano",
    "gpt-4o":               "gpt-4o",
    "gpt-4.1":              "gpt-4.1",
    "o3":                   "o3",
    "o4-mini":              "o4-mini",
}

OLLAMA_MODEL_PREFIX = "ollama:"

def _ui_model_to_provider(ui_model: str) -> Dict[str, str]:
    raw = str(ui_model or "").strip()
    if raw.lower().startswith(OLLAMA_MODEL_PREFIX):
        model = raw.split(":", 1)[1].strip() or "llama3.1"
        return {"provider": "ollama", "model": model}

    # Convenience: if a user enters a bare llama* model name, treat it as Ollama.
    if raw.lower().startswith("llama"):
        return {"provider": "ollama", "model": raw}

    # Default: OpenAI, with UI->API model mapping.
    if raw == "":
        raw = "gpt-5-instant"
    return {"provider": "openai", "model": OPENAI_MODEL_MAP.get(raw, raw)}

def _should_demo(project: Dict[str, Any]) -> bool:
    if PUBLIC_DEMO:
        return True
    spec = _ui_model_to_provider((project or {}).get("model") or "")
    if spec.get("provider") == "openai":
        return not (api_key and str(api_key).startswith("sk-"))
    return False

def _demo_reply() -> str:
    return DEMO_REPLY

def resolve_provider(project: Dict[str, Any]) -> Dict[str, Any]:
    if PUBLIC_DEMO:
        raise HTTPException(403, "CV demo: live AI disabled.")

    ui_model = (project or {}).get("model") or "gpt-5-instant"
    spec = _ui_model_to_provider(str(ui_model))

    if spec["provider"] == "ollama":
        base = (os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434") or "").strip().rstrip("/")
        url = f"{base}/v1/chat/completions"
        return {
            "name": "ollama",
            "url": url,
            "model": spec["model"],
            "supports_tools": _env_flag("OLLAMA_SUPPORTS_TOOLS", default=False),
            "headers": {
                "Content-Type": "application/json",
            },
        }

    if not api_key or not api_key.startswith("sk-"):
        raise HTTPException(500, "No OpenAI API key configured.")

    url = "https://api.openai.com/v1/chat/completions"

    return {
        "name": "openai",
        "url": url,
        "model": spec["model"],
        "supports_tools": True,
        "headers": {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    }

def post_json(url: str, payload: dict, headers: dict) -> dict:
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    try:
        r.raise_for_status()
    except Exception:
        raise HTTPException(502, (getattr(r, "text", "") or str(r))[:800])
    return r.json()

def _extract_from_chat_completions(data: Dict[str, Any]) -> str:
    try:
        return data["choices"][0]["message"]["content"]
    except Exception:
        return ""

def _clean_chat_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    cleaned: List[Dict[str, str]] = []
    for m in messages or []:
        role = (m or {}).get("role")
        content = (m or {}).get("content")
        if role not in ("system", "user", "assistant"):
            continue
        cleaned.append({"role": role, "content": "" if content is None else str(content)})
    return cleaned

def _llm_call(messages: List[Dict[str, Any]], project: Dict[str, Any], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    provider = resolve_provider(project)
    payload: Dict[str, Any] = {"model": provider["model"], "messages": messages}
    if tools and bool(provider.get("supports_tools")):
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    data = post_json(provider["url"], payload, provider["headers"])
    try:
        return data["choices"][0]["message"] or {}
    except Exception:
        return {}

def _llm_denied_path(rel: str) -> bool:
    rel = (rel or "").replace("\\", "/").lstrip("/")
    parts = [p for p in rel.split("/") if p not in ("", ".")]

    if any(p == ".." for p in parts):
        return True

    deny_dirs = {".git", "node_modules", "__pycache__", "output", "data"}
    if any(p in deny_dirs for p in parts):
        return True

    filename = parts[-1] if parts else ""
    if filename in {".env"}:
        return True

    deny_exts = {".pem", ".key", ".pfx", ".p12"}
    _, ext = os.path.splitext(filename.lower())
    if ext in deny_exts:
        return True

    return False

def _llm_assert_path_allowed(path: str):
    if _llm_denied_path(path):
        raise HTTPException(403, "Path is not allowed for LLM tools.")

def _llm_capabilities_prompt(pid: str) -> str:
    root = workspace_root(pid)
    allow_write = _env_flag("LLM_ALLOW_WRITE", default=True)
    allow_delete = _env_flag("LLM_ALLOW_DELETE", default=False)
    allow_rename = _env_flag("LLM_ALLOW_RENAME", default=True)
    allow_instructions_edit = _env_flag("LLM_ALLOW_INSTRUCTIONS_EDIT", default=True)
    return (
        "You have local file tools via this server.\n"
        f"- Project id: {pid}\n"
        f"- Project root (absolute): {root}\n"
        "- Tools: list_files, read_file, write_file, mkdir, delete_path, move_path, search_text, get_capabilities, get_project_instructions, set_project_instructions\n"
        f"- write_file allowed: {allow_write}\n"
        f"- delete_path allowed: {allow_delete}\n"
        f"- move_path allowed: {allow_rename}\n"
        f"- set_project_instructions allowed: {allow_instructions_edit}\n"
        "- All tool paths MUST be relative to the project root.\n"
        "- Never try to access secrets (for example `.env`, `.pem`, `.key`) or `.git`/`node_modules`.\n"
        "- You may suggest short instruction/rule changes, but DO NOT apply them unless the user explicitly includes `ALLOW_INSTRUCTIONS_EDIT=YES` in their most recent message.\n"
        "- If asked to change code/files, use the tools and be explicit about what you will read/write.\n"
    )

def _llm_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_capabilities",
                "description": "Return server and tool capabilities for the current project.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files/directories at a relative path within the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Relative directory path ('' for root)."}},
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a UTF-8 text file at a relative path within the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Relative file path."},
                        "max_chars": {"type": "integer", "description": "Max characters to return.", "default": 50000},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write a UTF-8 text file at a relative path within the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Relative file path."},
                        "content": {"type": "string", "description": "Full file content to write."},
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mkdir",
                "description": "Create a directory at a relative path within the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Relative directory path."}},
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delete_path",
                "description": "Delete a file or directory (recursive) within the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Relative path."}},
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "move_path",
                "description": "Move/rename a file or directory within the project root.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "src": {"type": "string", "description": "Relative source path."},
                        "dst": {"type": "string", "description": "Relative destination path."},
                    },
                    "required": ["src", "dst"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_text",
                "description": "Search for a substring in UTF-8 text files under a relative directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Substring to search for."},
                        "path": {"type": "string", "description": "Relative directory path to search within.", "default": ""},
                        "max_results": {"type": "integer", "description": "Max matches to return.", "default": 50},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_project_instructions",
                "description": "Read the current project instructions (system prompt) and basic settings.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "set_project_instructions",
                "description": "Update the project's instructions (system prompt). Only allowed if the user explicitly authorized it in their most recent message.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "system_prompt": {"type": "string", "description": "New full system prompt to store for this project."},
                        "authorization": {"type": "string", "description": "Must be exactly 'ALLOW_INSTRUCTIONS_EDIT=YES' and must appear in the most recent user message."},
                    },
                    "required": ["system_prompt", "authorization"],
                    "additionalProperties": False,
                },
            },
        },
    ]

def _llm_user_authorized_for_instruction_edit(last_user_message: str, authorization: str) -> bool:
    if authorization != "ALLOW_INSTRUCTIONS_EDIT=YES":
        return False
    if not last_user_message:
        return False
    # Require the exact token on its own line to avoid accidental triggers.
    return re.search(r"(?m)^ALLOW_INSTRUCTIONS_EDIT=YES\s*$", str(last_user_message)) is not None

def _llm_execute_tool(pid: str, name: str, args: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Any:
    root = workspace_root(pid)
    allow_write = _env_flag("LLM_ALLOW_WRITE", default=True)
    allow_delete = _env_flag("LLM_ALLOW_DELETE", default=False)
    allow_rename = _env_flag("LLM_ALLOW_RENAME", default=True)
    allow_instructions_edit = _env_flag("LLM_ALLOW_INSTRUCTIONS_EDIT", default=True)
    last_user_message = str((context or {}).get("last_user_message") or "")

    if name == "get_capabilities":
        return {
            "project_id": pid,
            "project_root": root,
            "tools": ["list_files", "read_file", "write_file", "mkdir", "delete_path", "move_path", "search_text", "get_capabilities", "get_project_instructions", "set_project_instructions"],
            "allow_write": allow_write,
            "allow_delete": allow_delete,
            "allow_rename": allow_rename,
            "allow_instructions_edit": allow_instructions_edit,
            "instructions_edit_requires": "Most recent user message must include ALLOW_INSTRUCTIONS_EDIT=YES on its own line.",
            "denied": {
                "dirs": [".git", "node_modules", "__pycache__", "output", "data"],
                "files": [".env"],
                "exts": [".pem", ".key", ".pfx", ".p12"],
            },
            "time_utc": now_iso(),
        }

    if name == "list_files":
        path = str(args.get("path", ""))
        _llm_assert_path_allowed(path)
        data = api_files_list(pid, path=path)
        entries = data.get("entries") or []
        filtered = []
        for e in entries:
            n = (e or {}).get("name") or ""
            relp = (path.rstrip("/\\") + "/" + n).lstrip("/") if path else str(n)
            if _llm_denied_path(relp):
                continue
            filtered.append(e)
        return {"entries": filtered}

    if name == "read_file":
        path = str(args.get("path", ""))
        max_chars = int(args.get("max_chars", 50000))
        max_chars = max(1, min(max_chars, 200000))
        _llm_assert_path_allowed(path)
        target = safe_join(root, path)
        if not os.path.isfile(target):
            raise HTTPException(404, "File not found")
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(max_chars)
        return {"path": path, "content": content}

    if name == "write_file":
        if not allow_write:
            raise HTTPException(403, "LLM write is disabled (set LLM_ALLOW_WRITE=1 to enable).")
        path = str(args.get("path", ""))
        content = "" if args.get("content") is None else str(args.get("content"))
        if len(content) > 500000:
            raise HTTPException(413, "Content too large")
        _llm_assert_path_allowed(path)
        return api_files_write(pid, FileWrite(path=path, content=content))

    if name == "mkdir":
        if not allow_write:
            raise HTTPException(403, "LLM write is disabled (set LLM_ALLOW_WRITE=1 to enable).")
        path = str(args.get("path", ""))
        _llm_assert_path_allowed(path)
        return api_files_mkdir(pid, PathBody(path=path))

    if name == "delete_path":
        if not allow_delete:
            raise HTTPException(403, "LLM delete is disabled (set LLM_ALLOW_DELETE=1 to enable).")
        path = str(args.get("path", ""))
        _llm_assert_path_allowed(path)
        return api_files_delete(pid, PathBody(path=path))

    if name == "move_path":
        if not allow_rename:
            raise HTTPException(403, "LLM move/rename is disabled (set LLM_ALLOW_RENAME=1 to enable).")
        src = str(args.get("src", ""))
        dst = str(args.get("dst", ""))
        _llm_assert_path_allowed(src)
        _llm_assert_path_allowed(dst)
        return api_files_rename(pid, RenameMoveBody(src=src, dst=dst))

    if name == "search_text":
        query = str(args.get("query", ""))
        path = str(args.get("path", ""))
        max_results = int(args.get("max_results", 50))
        max_results = max(1, min(max_results, 200))
        _llm_assert_path_allowed(path)
        start_dir = safe_join(root, path)
        if not os.path.isdir(start_dir):
            return {"matches": []}

        matches = []
        for dirpath, dirnames, filenames in os.walk(start_dir):
            dirnames[:] = [d for d in dirnames if not _llm_denied_path(os.path.relpath(os.path.join(dirpath, d), root))]
            for fn in filenames:
                relp = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                if _llm_denied_path(relp):
                    continue
                fp = os.path.join(dirpath, fn)
                try:
                    if os.path.getsize(fp) > 500000:
                        continue
                    with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                    if query in text:
                        idx = text.find(query)
                        start = max(0, idx - 80)
                        end = min(len(text), idx + len(query) + 80)
                        matches.append({"path": relp, "preview": text[start:end]})
                        if len(matches) >= max_results:
                            return {"matches": matches, "truncated": True}
                except Exception:
                    continue
        return {"matches": matches, "truncated": False}

    if name == "get_project_instructions":
        ensure_data_dirs()
        data = read_json(PROJECTS_FILE, {"projects": []})
        proj = next((p for p in data.get("projects") or [] if p.get("id") == pid), None)
        if not proj:
            raise HTTPException(404, "Project not found")
        return {
            "id": proj.get("id"),
            "name": proj.get("name"),
            "model": proj.get("model"),
            "root": proj.get("root"),
            "system_prompt": proj.get("system_prompt") or "",
            "updated_at": proj.get("updated_at"),
        }

    if name == "set_project_instructions":
        if not allow_instructions_edit:
            raise HTTPException(403, "Instruction editing is disabled (set LLM_ALLOW_INSTRUCTIONS_EDIT=1 to enable).")
        authorization = str(args.get("authorization") or "")
        if not _llm_user_authorized_for_instruction_edit(last_user_message, authorization):
            raise HTTPException(403, "Not authorized. Include `ALLOW_INSTRUCTIONS_EDIT=YES` on its own line in your most recent user message.")
        new_prompt = str(args.get("system_prompt") or "")
        if len(new_prompt) > 20000:
            raise HTTPException(413, "System prompt too large")
        ensure_data_dirs()
        data = read_json(PROJECTS_FILE, {"projects": []})
        projects = data.get("projects") or []
        for p in projects:
            if p.get("id") == pid:
                p["system_prompt"] = new_prompt
                p["updated_at"] = now_iso()
                write_json(PROJECTS_FILE, {"projects": projects})
                return {"status": "ok", "project": p}
        raise HTTPException(404, "Project not found")

    raise HTTPException(400, "Unknown tool")

    
# // ==================================================  
# // ============ CHUNK: LLM CHAT FUNCTION =============  
# // ==================================================
def llm_chat(messages: List[Dict[str, str]], project: Dict[str, Any]) -> str:
    """
    Uses Chat Completions.
    If the project's system_prompt is non-empty, prepend it as a system message.
    """
    if _should_demo(project):
        return _demo_reply()
    provider = resolve_provider(project)

    sys_prompt = ((project or {}).get("system_prompt") or "").strip()
    cleaned = _clean_chat_messages(messages)
    if sys_prompt:
        msgs = [{"role": "system", "content": sys_prompt}] + cleaned
    else:
        msgs = cleaned

    payload = {
        "model": provider["model"],
        "messages": msgs,  # [{"role":"user"/"assistant"/"system","content":"..."}]
    }
    data = post_json(provider["url"], payload, provider["headers"])
    return (_extract_from_chat_completions(data) or "").strip()

def llm_chat_agent(messages: List[Dict[str, Any]], project: Dict[str, Any], pid: str, max_steps: int = 8) -> str:
    """
    Chat-completions tool loop for local file read/write/search.
    """
    if _should_demo(project):
        return _demo_reply()
    sys_prompt = ((project or {}).get("system_prompt") or "").strip()
    cleaned = _clean_chat_messages(messages)
    convo: List[Dict[str, Any]] = []
    if sys_prompt:
        convo.append({"role": "system", "content": sys_prompt})
    convo.append({"role": "system", "content": _llm_capabilities_prompt(pid)})
    convo.extend(cleaned)
    last_user_message = ""
    for m in reversed(cleaned):
        if m.get("role") == "user":
            last_user_message = str(m.get("content") or "")
            break

    tools_enabled = _env_flag("LLM_TOOLS", default=True)
    tools = _llm_tools() if tools_enabled else None

    for _ in range(max(1, min(int(max_steps), 20))):
        msg = _llm_call(convo, project, tools=tools)
        tool_calls = msg.get("tool_calls") or []

        if tool_calls:
            assistant_msg: Dict[str, Any] = {"role": "assistant", "tool_calls": tool_calls}
            if msg.get("content") is not None:
                assistant_msg["content"] = msg.get("content")
            convo.append(assistant_msg)

            for tc in tool_calls:
                tc_id = tc.get("id") or ""
                fn = (tc.get("function") or {})
                name = fn.get("name") or ""
                raw_args = fn.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                except Exception:
                    args = {}
                try:
                    out = _llm_execute_tool(
                        pid,
                        name,
                        args if isinstance(args, dict) else {},
                        context={"last_user_message": last_user_message},
                    )
                except HTTPException as e:
                    out = {"error": True, "status_code": int(getattr(e, "status_code", 500)), "detail": str(getattr(e, "detail", "Tool error"))}
                except Exception as e:
                    out = {"error": True, "detail": str(e)}

                convo.append({"role": "tool", "tool_call_id": tc_id, "content": json.dumps(out, ensure_ascii=False)})
            continue

        return str((msg.get("content") or "")).strip()

    return "Error: tool loop exceeded maximum steps."






### // ==================================================
### // =============== CHUNK: STORAGE ===================
### // ==================================================
DATA_DIR = os.path.abspath("data")
PROJECTS_FILE = os.path.join(DATA_DIR, "projects.json")

def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def ensure_data_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(PROJECTS_FILE):
        with open(PROJECTS_FILE, "w", encoding="utf-8") as f:
            json.dump({"projects": []}, f, indent=2)

def read_json(path: str, default: Any=None) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default

def write_json(path: str, data: Any):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)

def project_dir(pid: str) -> str:
    return os.path.join(DATA_DIR, "projects", pid)

def chats_dir(pid: str) -> str:
    return os.path.join(project_dir(pid), "chats")

def chat_path(pid: str, cid: str) -> str:
    return os.path.join(chats_dir(pid), f"{cid}.json")

def sanitize_name(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._ -]+", "", (name or "").strip())
    s = re.sub(r"\s+", "_", s)
    return s or "project"

def default_workspace_root_by_name(name: str) -> str:
    return os.path.abspath(os.path.join(DATA_DIR, "workspaces", sanitize_name(name)))

def default_workspace_root_by_id(pid: str) -> str:
    return os.path.abspath(os.path.join(DATA_DIR, "workspaces", pid))

def workspace_root(pid: str) -> str:
    ensure_data_dirs()
    data = read_json(PROJECTS_FILE, {"projects": []})
    p = next((x for x in data["projects"] if x.get("id") == pid), None)
    root = (p or {}).get("root") or default_workspace_root_by_id(pid)
    os.makedirs(root, exist_ok=True)
    return os.path.abspath(root)

def safe_join(root: str, rel: str) -> str:
    target = os.path.abspath(os.path.join(root, rel or ""))
    if not target.startswith(os.path.abspath(root)):
        raise HTTPException(400, "Invalid path.")
    return target


###  ==================================================
###  =============== CHUNK: MODELS ====================
###  ==================================================
class ProjectCreate(BaseModel):
    name: str
    system_prompt: Optional[str] = ""
    model: Optional[str] = None
    root: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    root: Optional[str] = None

class ChatCreate(BaseModel):
    title: Optional[str] = None

class MessageIn(BaseModel):
    content: str


###  ==================================================
###  =============== CHUNK: PROJECTS API ==============
###  ==================================================
@app.get("/projects")
def api_list_projects():
    ensure_data_dirs()
    return {"projects": read_json(PROJECTS_FILE, {"projects": []})["projects"]}

@app.post("/projects")
def api_create_project(body: ProjectCreate):
    ensure_data_dirs()
    pid = str(uuid.uuid4())[:8]
    root = body.root or default_workspace_root_by_name(body.name)
    os.makedirs(root, exist_ok=True)

    DEFAULT_SYSTEM_PROMPT = (
        "You are a Sandbox Project GPT.\n"
        "You can read, write, create, move, and delete local project files through these backend routes:\n\n"
        "- GET  /projects/{pid}/files/list   ?path=subdir\n"
        "- POST /projects/{pid}/files/read   { \"path\": \"file.txt\" }\n"
        "- POST /projects/{pid}/files/write  { \"path\": \"file.txt\", \"content\": \"...\" }\n"
        "- POST /projects/{pid}/files/delete { \"path\": \"folder_or_file\" }\n"
        "- POST /projects/{pid}/files/rename { \"src\": \"old.txt\", \"dst\": \"new.txt\" }\n"
        "- POST /projects/{pid}/files/move   { \"src\": \"from/\", \"dst\": \"to/\" }\n\n"
        "You can edit files by reading them, modifying their content, and writing them back using /files/write.\n"
        "All paths are relative to your project workspace.\n"
        "Never step outside the workspace root.\n"
        "Describe the exact file operations you’ll perform when working with code."
    )

    p = {
        "id": pid,
        "name": body.name.strip() or f"Project {pid}",
        "system_prompt": body.system_prompt or DEFAULT_SYSTEM_PROMPT,
        "model": body.model,
        "root": root,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }

    data = read_json(PROJECTS_FILE, {"projects": []})
    data["projects"].append(p)
    write_json(PROJECTS_FILE, data)
    os.makedirs(chats_dir(pid), exist_ok=True)
    return {"project": p}

@app.put("/projects/{pid}")
def api_update_project(pid: str, body: ProjectUpdate):
    ensure_data_dirs()
    data = read_json(PROJECTS_FILE, {"projects": []})
    proj = next((p for p in data["projects"] if p.get("id") == pid), None)
    if not proj:
        raise HTTPException(404, "Project not found")

    # update allowed fields
    if body.name is not None:
        proj["name"] = (body.name or "").strip() or proj["name"]
    if body.system_prompt is not None:
        proj["system_prompt"] = body.system_prompt or ""
    if body.model is not None:
        proj["model"] = body.model or None
    if body.root is not None:
        new_root = (body.root or "").strip()
        proj["root"] = new_root if new_root else default_workspace_root_by_id(pid)
        os.makedirs(proj["root"], exist_ok=True)

    proj["updated_at"] = now_iso()
    write_json(PROJECTS_FILE, data)
    return {"project": proj}

@app.delete("/projects/{pid}")
def api_delete_project(pid: str):
    ensure_data_dirs()
    data = read_json(PROJECTS_FILE, {"projects": []})
    if not any(p.get("id") == pid for p in data["projects"]):
        raise HTTPException(404, "Project not found")
    data["projects"] = [p for p in data["projects"] if p.get("id") != pid]
    write_json(PROJECTS_FILE, data)
    shutil.rmtree(project_dir(pid), ignore_errors=True)
    shutil.rmtree(default_workspace_root_by_id(pid), ignore_errors=True)
    try:
        shutil.rmtree(workspace_root(pid), ignore_errors=True)
    except Exception:
        pass
    return {"status": "ok"}




###  ==================================================
###  =============== CHUNK: CHATS API =================
###  ==================================================
@app.get("/projects/{pid}/chats")
def api_list_chats(pid: str):
    cdir = chats_dir(pid)
    os.makedirs(cdir, exist_ok=True)
    chats = []
    for f in os.listdir(cdir):
        if f.endswith(".json"):
            chats.append(read_json(os.path.join(cdir, f), {}))
    chats.sort(key=lambda c: c.get("updated_at") or "", reverse=True)
    return {"chats": chats}


@app.post("/projects/{pid}/chats")
def api_create_chat(pid: str, body: ChatCreate):
    cid = str(uuid.uuid4())[:8]
    chat = {
        "id": cid,
        "project_id": pid,
        "title": body.title or f"Chat {cid}",
        "messages": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    os.makedirs(chats_dir(pid), exist_ok=True)
    write_json(chat_path(pid, cid), chat)
    return {"chat": chat}


@app.delete("/projects/{pid}/chats/{cid}")
def api_delete_chat(pid: str, cid: str):
    path = chat_path(pid, cid)
    if not os.path.exists(path):
        raise HTTPException(404, "Chat not found")
    os.remove(path)
    return {"status": "ok"}


def gather_project_files(pid: str, max_chars: int = 10000) -> str:
    """Collects small text snippets from files in the project's workspace."""
    root = workspace_root(pid)
    snippets = []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            try:
                p = os.path.join(dirpath, fn)
                with open(p, "r", encoding="utf-8") as f:
                    text = f.read(max_chars)
                    rel = os.path.relpath(p, root)
                    snippets.append(f"### {rel}\n{text}\n")
            except Exception:
                continue
    return "\n".join(snippets[: max_chars])


@app.post("/projects/{pid}/chats/{cid}/message")
def api_send_message(pid: str, cid: str, body: MessageIn):
    path = chat_path(pid, cid)
    chat = read_json(
        path,
        {"id": cid, "project_id": pid, "messages": [], "created_at": now_iso(), "updated_at": now_iso()},
    )

    user_msg = {"role": "user", "content": body.content, "ts": now_iso()}
    chat["messages"].append(user_msg)

    # lookup project, model, and system prompt
    data = read_json(PROJECTS_FILE, {"projects": []})
    proj = next((p for p in data["projects"] if p.get("id") == pid), {})
    model = proj.get("model") or "gpt-5-instant"
    system_prompt = proj.get("system_prompt") or ""

    # add project files context
    files_context = gather_project_files(pid)
    if files_context.strip():
        system_prompt = (system_prompt + "\n\n" + "### Project Files Context\n" + files_context).strip()

    model_messages = [{"role": m.get("role"), "content": m.get("content")} for m in (chat.get("messages") or [])]
    assistant = llm_chat_agent(model_messages, {"model": model, "system_prompt": system_prompt}, pid=pid)

    chat["messages"].append({"role": "assistant", "content": assistant, "ts": now_iso()})
    chat["updated_at"] = now_iso()
    write_json(path, chat)
    return {"reply": assistant}

###  ==================================================
###  =============== CHUNK: FILE OPS ==================
###  ==================================================
class FileRead(BaseModel):
    path: str

class FileWrite(BaseModel):
    path: str
    content: str

class PathBody(BaseModel):
    path: str

class RenameMoveBody(BaseModel):
    src: str
    dst: str

@app.get("/projects/{pid}/files/list")
def api_files_list(pid: str, path: Optional[str] = Query(default="")):
    root = workspace_root(pid)
    target = safe_join(root, path)
    if not os.path.isdir(target):
        return {"entries": []}
    entries = []
    for name in sorted(os.listdir(target)):
        p = os.path.join(target, name)
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(p) else "file",
            "size": os.path.getsize(p) if os.path.isfile(p) else None,
        })
    return {"entries": entries}

@app.post("/projects/{pid}/files/read")
def api_files_read(pid: str, body: FileRead):
    root = workspace_root(pid)
    target = safe_join(root, body.path)
    if not os.path.isfile(target):
        raise HTTPException(404, "File not found")
    with open(target, "r", encoding="utf-8") as f:
        return {"content": f.read()}

@app.post("/projects/{pid}/files/write")
def api_files_write(pid: str, body: FileWrite):
    root = workspace_root(pid)
    target = safe_join(root, body.path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        f.write(body.content)
    return {"status": "ok"}

@app.post("/projects/{pid}/files/mkdir")
def api_files_mkdir(pid: str, body: PathBody):
    root = workspace_root(pid)
    target = safe_join(root, body.path)
    os.makedirs(target, exist_ok=True)
    return {"status": "ok"}

@app.post("/projects/{pid}/files/create")
def api_files_create(pid: str, body: PathBody):
    root = workspace_root(pid)
    target = safe_join(root, body.path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if not os.path.exists(target):
        open(target, "a").close()
    return {"status": "ok"}

@app.post("/projects/{pid}/files/delete")
def api_files_delete(pid: str, body: PathBody):
    root = workspace_root(pid)
    target = safe_join(root, body.path)
    if not os.path.exists(target):
        return {"status": "ok"}
    if os.path.isdir(target):
        shutil.rmtree(target)
    else:
        os.remove(target)
    return {"status": "ok"}

@app.post("/projects/{pid}/files/rename")
def api_files_rename(pid: str, body: RenameMoveBody):
    root = workspace_root(pid)
    src = safe_join(root, body.src)
    dst = safe_join(root, body.dst)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.replace(src, dst)
    return {"status": "ok"}

@app.post("/projects/{pid}/files/move")
def api_files_move(pid: str, body: RenameMoveBody):
    return api_files_rename(pid, body)

@app.post("/projects/{pid}/files/upload")
async def api_files_upload(pid: str, path: str = Form(""), file: UploadFile = File(...)):
    root = workspace_root(pid)
    dir_target = safe_join(root, path)
    os.makedirs(dir_target, exist_ok=True)
    out_path = safe_join(root, os.path.join(path, file.filename))
    with open(out_path, "wb") as f:
        f.write(await file.read())
    return {"status": "ok", "name": file.filename}

@app.get("/projects/{pid}/files/download")
def api_files_download(pid: str, path: str):
    root = workspace_root(pid)
    target = safe_join(root, path)
    if not os.path.isfile(target):
        raise HTTPException(404, "File not found")
    filename = os.path.basename(target)
    return FileResponse(target, filename=filename, media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream")


# main.py
###  ==================================================
###  =============== CHUNK: VOICE =====================
###  ==================================================
@app.post("/voice/stt")
async def voice_stt(file: UploadFile = File(...), model: str = Form("whisper-1")):
    if PUBLIC_DEMO:
        raise HTTPException(403, "CV demo: voice disabled.")
    if not api_key:
        raise HTTPException(500, "No API key for STT")
    url = "https://api.openai.com/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {
        "file": (file.filename, await file.read(), file.content_type or "audio/webm"),
        "model": (None, model),
    }
    r = requests.post(url, headers=headers, files=files, timeout=120)
    r.raise_for_status()
    return {"text": r.json().get("text", "")}

class TTSBody(BaseModel):
    text: str
    voice: Optional[str] = "alloy"
    model: Optional[str] = "tts-1"
    format: Optional[str] = "mp3"

@app.post("/voice/tts")
def voice_tts(body: TTSBody):
    if PUBLIC_DEMO:
        raise HTTPException(403, "CV demo: voice disabled.")
    if not api_key:
        raise HTTPException(500, "No API key for TTS")
    url = "https://api.openai.com/v1/audio/speech"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": body.model, "voice": body.voice, "input": body.text, "format": body.format}
    r = requests.post(url, headers=headers, json=payload, timeout=120)
    r.raise_for_status()
    ext = body.format or "mp3"
    fname = f"speech.{ext}"
    tmp_path = os.path.join(DATA_DIR, fname)
    with open(tmp_path, "wb") as f:
        f.write(r.content)
    return FileResponse(tmp_path, filename=fname, media_type=f"audio/{ext}")

# ==================================================
# =============== FRONTEND MOUNT ===================
# ==================================================
ROOT = Path(__file__).parent.resolve()

def _find_frontend_build():
    for p in [
        ROOT / "frontend" / "build",
        ROOT / "gpt-chat" / "build",
        ROOT / "app" / "build",
        ROOT / "build",
    ]:
        if (p / "index.html").exists():
            return p
    return None

FRONTEND_DIR = _find_frontend_build()
if FRONTEND_DIR:
    INDEX_FILE = FRONTEND_DIR / "index.html"
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")

    @app.get("/", include_in_schema=False)
    async def serve_index_root():
        return FileResponse(INDEX_FILE)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_index_spa(full_path: str):
        candidate = (FRONTEND_DIR / full_path).resolve()
        if candidate.is_file() and str(candidate).startswith(str(FRONTEND_DIR)):
            return FileResponse(candidate)
        return FileResponse(INDEX_FILE)


