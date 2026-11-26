"use strict";
/* CYBERPUNK RED IDE — in-browser editor + shell emulator.
   The terminal here is an emulator running on a virtual file system in
   this browser. It is NOT a real Linux system. A real local shell is
   available only through the optional server.py (localhost only). */

const LS_KEY = "cyberpunk-red-ide-fs-v1";
const LS_OPEN_KEY = "cyberpunk-red-ide-open-v1";

/* ---------- virtual file system ---------- */
function defaultFS() {
  return {
    type: "dir",
    children: {
      "hello.py": { type: "file", content: "# Hello from the red IDE.\n# Edit me, then press the terminal below and try:\n#   cat hello.py\n\nprint(\"Hello, neon world.\")\n" },
      "script.js": { type: "file", content: "// A tiny script. The editor highlights JS, Python, HTML, CSS, JSON, MD.\nconst msg = \"stay neon\";\nconsole.log(msg);\n" },
      "notes.md": { type: "file", content: "# Notes\n\n- Files save in this browser only (localStorage).\n- The terminal is an emulator, not real Linux.\n- Run `server.py` on your own computer for a real local shell.\n" },
      "style.css": { type: "file", content: "/* Red on black. */\nbody {\n  background: #0a0000;\n  color: #ffd9d9;\n}\n" }
    }
  };
}

let fs;
try {
  const raw = localStorage.getItem(LS_KEY);
  fs = raw ? JSON.parse(raw) : defaultFS();
  if (!fs || fs.type !== "dir") fs = defaultFS();
} catch (e) { fs = defaultFS(); }

function saveFS() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(fs)); } catch (e) {}
}

let cwd = [];            // array of path segments, [] = root
let openFiles = [];      // array of absolute paths like "/hello.py"
let activeFile = null;   // absolute path
try {
  const raw = localStorage.getItem(LS_OPEN_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed)) openFiles = parsed.filter(p => getNode(p));
} catch (e) { openFiles = []; }
if (openFiles.length) activeFile = openFiles[0];

function splitPath(p) {
  return p.split("/").filter(s => s.length > 0);
}
function resolvePath(input) {
  // Returns array of segments. Supports absolute, relative, ".", "..", "~".
  let parts;
  if (input.startsWith("/")) parts = splitPath(input);
  else if (input.startsWith("~/")) parts = splitPath(input.slice(2));
  else parts = cwd.concat(splitPath(input));
  const out = [];
  for (const seg of parts) {
    if (seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out;
}
function pathStr(parts) { return "/" + parts.join("/"); }
function getNode(partsOrStr) {
  const parts = Array.isArray(partsOrStr) ? partsOrStr : splitPath(partsOrStr);
  let node = fs;
  for (const seg of parts) {
    if (!node || node.type !== "dir") return null;
    node = node.children[seg];
  }
  return node || null;
}
function parentAndName(parts) {
  const parent = getNode(parts.slice(0, -1));
  return [parent, parts[parts.length - 1]];
}
function listNames(parts) {
  const node = getNode(parts);
  if (!node || node.type !== "dir") return null;
  return Object.keys(node.children).sort((a, b) => {
    const na = node.children[a], nb = node.children[b];
    if ((na.type === "dir") !== (nb.type === "dir")) return na.type === "dir" ? -1 : 1;
    return a.localeCompare(b);
  });
}
function countFiles(node) {
  let n = 0;
  for (const child of Object.values(node.children || {})) {
    if (child.type === "file") n++;
    else n += countFiles(child);
  }
  return n;
}

/* ---------- syntax highlighting ---------- */
const KEYWORDS = {
  py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None print len range str int float list dict set".split(" "),
  js: "break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let await async of".split(" "),
  html: [],
  css: [],
  json: ["true", "false", "null"],
  sh: "if then else elif fi for while do done case esac function in echo cd ls exit return".split(" "),
  md: []
};
function langOf(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "py") return "py";
  if (ext === "js" || ext === "mjs" || ext === "ts") return "js";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "json") return "json";
  if (ext === "sh" || ext === "bash") return "sh";
  return "md";
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function highlight(code, lang) {
  const kws = KEYWORDS[lang] || [];
  const kwAlt = kws.length ? kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") : null;
  const strRe = "'(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`";
  const comRe = lang === "py" || lang === "sh" ? "#[^\\n]*" : lang === "css" ? "\\/\\*[\\s\\S]*?\\*\\/" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const parts = ["(" + strRe + ")", "(" + comRe + ")", "(\\b\\d+(?:\\.\\d+)?\\b)"];
  if (kwAlt) parts.push("(\\b(?:" + kwAlt + ")\\b)");
  const re = new RegExp(parts.join("|"), "g");
  let out = "", last = 0, m;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const tok = m[0];
    let cls = "tok-kw";
    if (m[1] !== undefined) cls = "tok-str";
    else if (m[2] !== undefined) cls = "tok-com";
    else if (m[3] !== undefined) cls = "tok-num";
    out += '<span class="' + cls + '">' + escapeHtml(tok) + "</span>";
    last = m.index + tok.length;
  }
  out += escapeHtml(code.slice(last));
  return out + (code.endsWith("\n") ? " " : "");
}

/* ---------- editor ---------- */
const editor = document.getElementById("editor");
const hlCode = document.getElementById("highlight-code");
const hlPre = document.getElementById("highlight");
const tabsEl = document.getElementById("tabs");
const editorStatus = document.getElementById("editor-status");
const treeEl = document.getElementById("file-tree");
const statusFiles = document.getElementById("status-files");

function saveOpen() {
  try { localStorage.setItem(LS_OPEN_KEY, JSON.stringify(openFiles)); } catch (e) {}
}
function renderTabs() {
  tabsEl.innerHTML = "";
  for (const p of openFiles) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab" + (p === activeFile ? " active" : "");
    const name = document.createElement("span");
    name.textContent = p.split("/").pop();
    const x = document.createElement("span");
    x.className = "tab-close";
    x.textContent = "×";
    x.addEventListener("click", (ev) => { ev.stopPropagation(); closeFile(p); });
    tab.appendChild(name);
    tab.appendChild(x);
    tab.addEventListener("click", () => openFile(p));
    tabsEl.appendChild(tab);
  }
}
function renderTree() {
  treeEl.innerHTML = "";
  function walk(node, parts, depth) {
    for (const name of listNames(parts) || []) {
      const child = node.children[name];
      const p = pathStr(parts.concat([name]));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = child.type === "dir" ? "ft-dir" : "ft-file";
      if (p === activeFile) btn.classList.add("active");
      const indent = document.createElement("span");
      indent.className = "indent";
      indent.textContent = "  ".repeat(depth) + (child.type === "dir" ? "▸ " : "  ");
      const label = document.createElement("span");
      label.textContent = name;
      btn.appendChild(indent);
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        if (child.type === "dir") openFile(p);
        else openFile(p);
      });
      treeEl.appendChild(btn);
      if (child.type === "dir") walk(child, parts.concat([name]), depth + 1);
    }
  }
  walk(fs, [], 0);
  statusFiles.textContent = countFiles(fs) + " files";
}
function syncEditor() {
  const node = activeFile ? getNode(activeFile) : null;
  if (!node || node.type !== "file") {
    editor.value = "";
    hlCode.innerHTML = "";
    editor.placeholder = "// pick a file on the left, or press + New file";
    editorStatus.textContent = "No file open.";
    editor.disabled = true;
    return;
  }
  editor.disabled = false;
  if (editor.value !== node.content) editor.value = node.content;
  hlCode.innerHTML = highlight(node.content, langOf(activeFile));
  editorStatus.textContent = activeFile + "  ·  " + langOf(activeFile) + "  ·  " + node.content.length + " chars";
}
function openFile(p) {
  const node = getNode(p);
  if (!node) return;
  if (node.type === "dir") { cwd = splitPath(p); renderPrompt(); return; }
  if (!openFiles.includes(p)) openFiles.push(p);
  activeFile = p;
  saveOpen();
  renderTabs();
  renderTree();
  syncEditor();
  editor.focus();
}
function closeFile(p) {
  openFiles = openFiles.filter(f => f !== p);
  if (activeFile === p) activeFile = openFiles.length ? openFiles[openFiles.length - 1] : null;
  saveOpen();
  renderTabs();
  renderTree();
  syncEditor();
}
editor.addEventListener("input", () => {
  const node = activeFile ? getNode(activeFile) : null;
  if (!node) return;
  node.content = editor.value;
  saveFS();
  syncEditor();
});
editor.addEventListener("scroll", () => {
  hlPre.scrollTop = editor.scrollTop;
  hlPre.scrollLeft = editor.scrollLeft;
});
editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.setRangeText("  ", s, en, "end");
    editor.dispatchEvent(new Event("input"));
  }
});
document.getElementById("btn-new-file").addEventListener("click", () => {
  const name = prompt("New file name (e.g. app.py):", "untitled.txt");
  if (!name) return;
  const clean = name.trim().replace(/^\/+/, "");
  if (!clean || clean.includes("/")) { alert("One file name, no folders. Example: app.py"); return; }
  const parts = cwd.concat([clean]);
  const [parent, base] = parentAndName(parts);
  if (!parent || parent.type !== "dir") return;
  if (parent.children[base]) { alert("That file already exists here."); return; }
  parent.children[base] = { type: "file", content: "" };
  saveFS();
  renderTree();
  openFile(pathStr(parts));
  termPrint("created " + pathStr(parts), "t-dim");
});
document.getElementById("btn-delete-file").addEventListener("click", () => {
  if (!activeFile) { alert("Open a file first."); return; }
  if (!confirm("Delete " + activeFile + "?")) return;
  const parts = splitPath(activeFile);
  const [parent, base] = parentAndName(parts);
  if (parent && parent.children[base]) delete parent.children[base];
  saveFS();
  closeFile(activeFile);
  renderTree();
});
document.getElementById("btn-run").addEventListener("click", () => {
  termPrint("Run is a note, not execution: this page cannot run Python by itself.", "t-dim");
  termPrint("Copy the file to your own computer and run:  python3 " + (activeFile || "hello.py"), "t-dim");
});

/* ---------- terminal emulator ---------- */
const termOut = document.getElementById("term-output");
const termInput = document.getElementById("term-input");
const termPrompt = document.getElementById("term-prompt");
const termMode = document.getElementById("term-mode");
const history = [];
let histIdx = -1;
let remote = null; // WebSocket when connected to server.py

function renderPrompt() {
  const where = cwd.length ? "~/" + cwd.join("/") : "~";
  termPrompt.textContent = "guest@red-ide:" + where + "$";
}
function termPrint(text, cls) {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = text;
  termOut.appendChild(div);
  termOut.scrollTop = termOut.scrollHeight;
}
function termEcho(cmd) {
  const div = document.createElement("div");
  div.className = "t-cmd";
  div.textContent = termPrompt.textContent + " " + cmd;
  termOut.appendChild(div);
  termOut.scrollTop = termOut.scrollHeight;
}
function parseArgs(line) {
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) args.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  return args;
}
function runCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const args = parseArgs(trimmed);
  const cmd = args[0];
  const rest = args.slice(1);
  switch (cmd) {
    case "help":
      termPrint("Commands: help, ls, cd, pwd, cat, echo, touch, mkdir, rm, open, new, date, whoami, net, clear", "t-dim");
      termPrint("This is an emulator on files stored in this browser. Not real Linux.", "t-dim");
      break;
    case "pwd":
      termPrint(pathStr(cwd) === "/" ? "/" : "/home/guest" + pathStr(cwd));
      break;
    case "ls": {
      const target = rest[0] ? resolvePath(rest[0]) : cwd;
      const node = getNode(target);
      if (!node) { termPrint("ls: no such file or directory: " + (rest[0] || ""), "t-err"); break; }
      if (node.type === "file") { termPrint(rest[0]); break; }
      for (const name of listNames(target) || []) {
        const child = node.children[name];
        termPrint(child.type === "dir" ? name + "/" : name);
      }
      break;
    }
    case "cd": {
      const dest = rest[0] ? resolvePath(rest[0]) : [];
      const node = getNode(dest);
      if (!node || node.type !== "dir") { termPrint("cd: no such directory: " + (rest[0] || ""), "t-err"); break; }
      cwd = dest;
      renderPrompt();
      break;
    }
    case "cat": {
      if (!rest[0]) { termPrint("usage: cat <file>", "t-err"); break; }
      const node = getNode(resolvePath(rest[0]));
      if (!node || node.type !== "file") { termPrint("cat: no such file: " + rest[0], "t-err"); break; }
      termPrint(node.content.replace(/\n$/, ""));
      break;
    }
    case "echo":
      termPrint(rest.join(" "));
      break;
    case "touch": {
      if (!rest[0]) { termPrint("usage: touch <file>", "t-err"); break; }
      const parts = resolvePath(rest[0]);
      const [parent, base] = parentAndName(parts);
      if (!parent || parent.type !== "dir") { termPrint("touch: bad path", "t-err"); break; }
      if (!parent.children[base]) parent.children[base] = { type: "file", content: "" };
      saveFS(); renderTree();
      break;
    }
    case "mkdir": {
      if (!rest[0]) { termPrint("usage: mkdir <name>", "t-err"); break; }
      const parts = resolvePath(rest[0]);
      const [parent, base] = parentAndName(parts);
      if (!parent || parent.type !== "dir") { termPrint("mkdir: bad path", "t-err"); break; }
      if (parent.children[base]) { termPrint("mkdir: already exists: " + rest[0], "t-err"); break; }
      parent.children[base] = { type: "dir", children: {} };
      saveFS(); renderTree();
      break;
    }
    case "rm": {
      if (!rest[0]) { termPrint("usage: rm <file>", "t-err"); break; }
      const parts = resolvePath(rest[0]);
      const [parent, base] = parentAndName(parts);
      if (!parent || !parent.children[base]) { termPrint("rm: no such file: " + rest[0], "t-err"); break; }
      delete parent.children[base];
      saveFS(); renderTree(); syncEditor();
      break;
    }
    case "open": {
      if (!rest[0]) { termPrint("usage: open <file>", "t-err"); break; }
      const p = pathStr(resolvePath(rest[0]));
      if (!getNode(p)) { termPrint("open: no such file: " + rest[0], "t-err"); break; }
      openFile(p);
      break;
    }
    case "new": {
      if (!rest[0]) { termPrint("usage: new <file>", "t-err"); break; }
      const parts = resolvePath(rest[0]);
      const [parent, base] = parentAndName(parts);
      if (!parent || parent.type !== "dir") { termPrint("new: bad path", "t-err"); break; }
      if (!parent.children[base]) parent.children[base] = { type: "file", content: "" };
      saveFS(); renderTree();
      openFile(pathStr(parts));
      break;
    }
    case "date":
      termPrint(new Date().toString());
      break;
    case "whoami":
      termPrint("guest");
      break;
    case "net":
      termPrint("status: " + (navigator.onLine ? "online" : "offline") + "  ·  connection: " + connectionInfo());
      termPrint("Web pages cannot scan Wi-Fi or nearby devices. See the NETWORK panel.", "t-dim");
      break;
    case "clear":
      termOut.innerHTML = "";
      break;
    default:
      termPrint(cmd + ": command not found (emulator — try: help)", "t-err");
  }
}
termInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const line = termInput.value;
    termInput.value = "";
    if (remote && remote.readyState === WebSocket.OPEN) {
      const div = document.createElement("div");
      div.className = "t-cmd";
      div.textContent = line;
      termOut.appendChild(div);
      remote.send(line + "\n");
      termOut.scrollTop = termOut.scrollHeight;
      return;
    }
    termEcho(line);
    history.unshift(line);
    histIdx = -1;
    runCommand(line);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (history.length) {
      histIdx = Math.min(histIdx + 1, history.length - 1);
      termInput.value = history[histIdx];
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (histIdx > 0) { histIdx--; termInput.value = history[histIdx]; }
    else { histIdx = -1; termInput.value = ""; }
  } else if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    termOut.innerHTML = "";
  }
});
document.getElementById("terminal-pane").addEventListener("click", () => termInput.focus());

/* ---------- network panel ---------- */
const netDot = document.getElementById("net-dot");
const netStatus = document.getElementById("net-status");
const netType = document.getElementById("net-type");
const netIp = document.getElementById("net-ip");
function connectionInfo() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return "not exposed by this browser";
  const bits = [];
  if (c.effectiveType) bits.push(c.effectiveType);
  if (c.downlink) bits.push(c.downlink + " Mb/s");
  if (c.rtt !== undefined) bits.push(c.rtt + " ms");
  return bits.length ? bits.join(" · ") : "exposed, no details";
}
function refreshNet() {
  const online = navigator.onLine;
  netDot.className = "dot " + (online ? "on" : "off");
  netStatus.textContent = online ? "Online" : "Offline";
  netType.textContent = connectionInfo();
}
window.addEventListener("online", refreshNet);
window.addEventListener("offline", refreshNet);
refreshNet();
document.getElementById("btn-ip").addEventListener("click", async () => {
  netIp.textContent = "looking up…";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    netIp.textContent = data.ip || "unknown";
  } catch (e) {
    netIp.textContent = "could not reach the IP service (offline or blocked)";
  }
});

/* ---------- optional local server (server.py) ---------- */
const serverLabel = document.getElementById("net-server");
const shellBtn = document.getElementById("btn-shell");
async function detectServer() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch("/api/health", { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      serverLabel.textContent = "detected — real shell available";
      shellBtn.disabled = false;
    } else {
      serverLabel.textContent = "not detected";
    }
  } catch (e) {
    serverLabel.textContent = "not detected";
  }
}
shellBtn.addEventListener("click", () => {
  if (remote) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/shell");
  ws.onopen = () => {
    remote = ws;
    termMode.textContent = "real shell (local server)";
    termPrint("Connected to the real local shell on your computer. Type exit to go back to the emulator.", "t-dim");
  };
  ws.onmessage = (ev) => {
    const div = document.createElement("div");
    div.textContent = ev.data;
    termOut.appendChild(div);
    termOut.scrollTop = termOut.scrollHeight;
  };
  ws.onclose = () => {
    remote = null;
    termMode.textContent = "emulator";
    termPrint("Real shell disconnected. Back to the emulator.", "t-dim");
  };
  ws.onerror = () => {
    termPrint("Could not open the real shell.", "t-err");
  };
});
detectServer();

/* ---------- boot ---------- */
renderTabs();
renderTree();
renderPrompt();
syncEditor();
termPrint("CYBERPUNK RED IDE — emulator shell. Type: help", "t-dim");
if (activeFile) editor.focus();
