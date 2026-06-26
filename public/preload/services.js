"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var services_exports = {};
__export(services_exports, {
  deleteProject: () => deleteProject,
  detectPresetPaths: () => detectPresetPaths,
  getIDEs: () => getIDEs,
  getPresets: () => getPresets,
  getQuickFillPresets: () => getQuickFillPresets,
  openProject: () => openProject,
  readProjects: () => readProjects,
  refreshPlugins: () => refreshPlugins,
  registerFeatures: () => registerFeatures,
  saveIDEs: () => saveIDEs
});
module.exports = __toCommonJS(services_exports);
var fs = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");
const WASM_DIR = path.join(__dirname, "node_modules", "sql.js", "dist");
const sqlJsCode = fs.readFileSync(path.join(WASM_DIR, "sql-wasm.js"), "utf-8");
const initSqlJs = new Function(
  "require",
  "module",
  "exports",
  sqlJsCode + "\nreturn module.exports;"
)(require, { exports: {} }, {}).default || require;
const wasmBinary = fs.readFileSync(path.join(WASM_DIR, "sql-wasm.wasm"));
let _SQL = null;
async function getSQL() {
  if (!_SQL) {
    _SQL = await initSqlJs({ wasmBinary });
  }
  return _SQL;
}
const RECENT_KEYS = [
  "history.recentlyOpenedPathsList",
  "history.openedPathsList",
  "openedPathsList"
];
async function readProjectsFromSQLite(dbPath) {
  const SQL = await getSQL();
  const candidates = [dbPath];
  const home2 = process.env.HOME || process.env.USERPROFILE;
  if (home2 && dbPath.includes(path.join("Code", "User", "globalStorage"))) {
    const shared = path.join(home2, ".vscode-shared", "sharedStorage", "state.vscdb");
    if (fs.existsSync(shared) && !candidates.includes(shared)) candidates.push(shared);
  }
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const buffer = fs.readFileSync(filePath);
    const db = new SQL.Database(buffer);
    try {
      for (const key of RECENT_KEYS) {
        const results = db.exec(`SELECT value FROM ItemTable WHERE key = '${key}'`);
        if (results.length > 0 && results[0].values.length > 0) {
          const value = results[0].values[0][0];
          const data = JSON.parse(value);
          const entries = data.entries || [];
          if (entries.length > 0) return parseEntries(entries);
        }
      }
    } finally {
      db.close();
    }
  }
  return [];
}
async function readProjectsFromJSON(jsonPath) {
  const content = fs.readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(content);
  const entries = data?.openedPathsList?.entries || [];
  return parseEntries(entries);
}
function readProjectsFromXML(xmlPath) {
  const content = fs.readFileSync(xmlPath, "utf-8");
  const pathRe = /<option\s+value="([^"]+)"\s*\/>/g;
  const paths = [];
  let m;
  while ((m = pathRe.exec(content)) !== null) {
    const v = m[1];
    if (v.startsWith("/") || v.match(/^[A-Z]:\\/)) paths.push(v);
  }
  const nameByPath = {};
  const entryRe = /<entry\s+key="([^"]+)"[^>]*>[\s\S]*?<option\s+name="projectName"\s+value="([^"]+)"\s*\/>[\s\S]*?<\/entry>/g;
  let n;
  while ((n = entryRe.exec(content)) !== null) {
    nameByPath[n[1]] = n[2];
  }
  return paths.map((p) => ({
    name: nameByPath[p] || path.basename(p),
    path: p,
    uri: p,
    type: "folder",
    label: nameByPath[p] || ""
  }));
}
function parseEntries(entries) {
  return entries.filter((e) => e != null && typeof e === "object").map((e) => {
    const uri = e.folderUri || e.fileUri || e.workspace?.configPath || "";
    if (!uri) return null;
    const decoded = decodeURIComponent(uri);
    const name = path.basename(
      decoded.replace(/^file:\/\//, "").replace(/^vscode-remote:\/\//, "")
    );
    const isRemote = uri.startsWith("vscode-remote://");
    const isWorkspace = uri.endsWith(".code-workspace");
    const isFile = !!e.fileUri && !e.folderUri;
    const localPath = isRemote ? "" : uriToPath(uri);
    return {
      name: e.label || name || "\u672A\u547D\u540D",
      path: localPath,
      uri,
      type: isRemote ? "remote" : isWorkspace ? "workspace" : isFile ? "file" : "folder",
      label: e.label || ""
    };
  }).filter(Boolean);
}
function uriToPath(uri) {
  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname);
  } catch {
    return uri;
  }
}
async function readProjects(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`\u6587\u4EF6\u4E0D\u5B58\u5728: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".vscdb" || ext === ".db") {
    return readProjectsFromSQLite(filePath);
  }
  if (ext === ".json") {
    return readProjectsFromJSON(filePath);
  }
  if (ext === ".xml") {
    return readProjectsFromXML(filePath);
  }
  try {
    return await readProjectsFromSQLite(filePath);
  } catch {
    return await readProjectsFromJSON(filePath);
  }
}
async function deleteProject(dbPath, uri) {
  const candidates = [dbPath];
  const home2 = process.env.HOME || process.env.USERPROFILE;
  if (home2 && dbPath.includes(path.join("Code", "User", "globalStorage"))) {
    const shared = path.join(home2, ".vscode-shared", "sharedStorage", "state.vscdb");
    if (fs.existsSync(shared) && !candidates.includes(shared)) candidates.push(shared);
  }
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".vscdb" && ext !== ".db") continue;
    const SQL = await getSQL();
    const buffer = fs.readFileSync(filePath);
    const db = new SQL.Database(buffer);
    try {
      for (const key of RECENT_KEYS) {
        const results = db.exec(`SELECT value FROM ItemTable WHERE key = '${key}'`);
        if (results.length === 0 || results[0].values.length === 0) continue;
        const value = results[0].values[0][0];
        const data = JSON.parse(value);
        const entries = data.entries || [];
        const before = entries.length;
        data.entries = entries.filter((e) => {
          if (typeof e === "string") return e !== uri;
          const ep = e.folderUri || e.fileUri || e.workspace?.configPath;
          return ep !== uri;
        });
        if (data.entries.length === before) continue;
        const updated = JSON.stringify(data);
        db.run(`UPDATE ItemTable SET value = ? WHERE key = '${key}'`, [updated]);
        const out = db.export();
        fs.writeFileSync(filePath, Buffer.from(out));
        return;
      }
    } finally {
      db.close();
    }
  }
  throw new Error("\u672A\u627E\u5230\u5339\u914D\u7684\u8BB0\u5F55\u6216\u6570\u636E\u5E93\u4E0D\u652F\u6301\u5220\u9664");
}
const STORAGE_KEY = "ide-ides";
function getIDEs() {
  try {
    const data = utools.dbStorage.getItem(STORAGE_KEY);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function saveIDEs(ides) {
  utools.dbStorage.setItem(STORAGE_KEY, ides);
}
function openProject(command, uri, shell) {
  return new Promise((resolve, reject) => {
    const isWorkspace = uri.endsWith(".code-workspace");
    const flag = isWorkspace ? "--file-uri" : "--folder-uri";
    const cmd = `${command} ${flag} "${uri}"`;
    const fullCmd = shell ? `${shell} '${cmd}'` : cmd;
    (0, import_node_child_process.exec)(fullCmd, { env: process.env, windowsHide: true, timeout: 3e3 }, (err) => {
      if (err) reject(new Error(`\u542F\u52A8\u5931\u8D25: ${err.message}`));
      else resolve();
    });
  });
}
const homeDir = () => process.env.HOME || process.env.USERPROFILE || "";
const jetBrainsDir = () => {
  const home2 = homeDir();
  if (process.platform === "darwin") return path.join(home2, "Library", "Application Support", "JetBrains");
  if (process.platform === "win32") return path.join(process.env.APPDATA || home2, "JetBrains");
  return path.join(home2, ".config", "JetBrains");
};
function getPresets() {
  const appData = utools.getPath("appData");
  const jbDir = jetBrainsDir();
  return {
    vscode: {
      name: "VSCode",
      command: "code",
      dbPaths: [
        path.join(home, ".vscode-shared", "sharedStorage", "state.vscdb"),
        path.join(appData, "Code", "User", "globalStorage", "state.vscdb"),
        path.join(appData, "Code", "storage.json")
      ]
    },
    cursor: {
      name: "Cursor",
      command: "cursor",
      dbPaths: [
        path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
        path.join(appData, "Cursor", "storage.json")
      ]
    },
    vscodium: {
      name: "VSCodium",
      command: "codium",
      dbPaths: [
        path.join(appData, "VSCodium", "User", "globalStorage", "state.vscdb"),
        path.join(appData, "VSCodium", "storage.json")
      ]
    },
    idea: {
      name: "IntelliJ IDEA",
      command: "idea",
      dbPaths: [path.join(jbDir, "IntelliJIdea*", "options", "recentProjects.xml")]
    },
    pycharm: {
      name: "PyCharm",
      command: "pycharm",
      dbPaths: [path.join(jbDir, "PyCharm*", "options", "recentProjects.xml")]
    },
    webstorm: {
      name: "WebStorm",
      command: "webstorm",
      dbPaths: [path.join(jbDir, "WebStorm*", "options", "recentProjects.xml")]
    },
    goland: {
      name: "GoLand",
      command: "goland",
      dbPaths: [path.join(jbDir, "GoLand*", "options", "recentProjects.xml")]
    },
    qoder: {
      name: "Qoder",
      command: "qoder",
      dbPaths: [
        path.join(appData, "Qoder", "User", "globalStorage", "state.vscdb"),
        path.join(appData, "Qoder", "storage.json"),
        path.join(appData, "Qoder", "User", "globalStorage", "storage.json")
      ]
    }
  };
}
const defaultShell = process.platform === "darwin" ? "zsh -l -i -c" : process.platform === "linux" ? "bash -l -i -c" : "";
function getQuickFillPresets() {
  const home2 = process.env.HOME || process.env.USERPROFILE || "";
  const appData = utools.getPath("appData");
  const jbDir = jetBrainsDir();
  const vscDbPath = home2 ? path.join(home2, ".vscode-shared", "sharedStorage", "state.vscdb") : path.join(appData, "Code", "User", "globalStorage", "state.vscdb");
  return [
    { code: "vsc", name: "VS Code", command: "code", dbPath: vscDbPath, shell: defaultShell },
    { code: "cursor", name: "Cursor", command: "cursor", dbPath: path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"), shell: defaultShell },
    { code: "codium", name: "VSCodium", command: "codium", dbPath: path.join(appData, "VSCodium", "User", "globalStorage", "state.vscdb"), shell: defaultShell },
    { code: "idea", name: "IntelliJ IDEA", command: "idea", dbPath: path.join(jbDir, "IntelliJIdea*", "options", "recentProjects.xml"), shell: defaultShell },
    { code: "pycharm", name: "PyCharm", command: "pycharm", dbPath: path.join(jbDir, "PyCharm*", "options", "recentProjects.xml"), shell: defaultShell },
    { code: "webstorm", name: "WebStorm", command: "webstorm", dbPath: path.join(jbDir, "WebStorm*", "options", "recentProjects.xml"), shell: defaultShell },
    { code: "goland", name: "GoLand", command: "goland", dbPath: path.join(jbDir, "GoLand*", "options", "recentProjects.xml"), shell: defaultShell },
    { code: "qoder", name: "Qoder", command: "qoder", dbPath: path.join(appData, "Qoder", "User", "globalStorage", "state.vscdb"), shell: defaultShell }
  ];
}
function detectPresetPaths() {
  const presets = getPresets();
  const result = {};
  for (const [key, preset] of Object.entries(presets)) {
    for (const p of preset.dbPaths) {
      if (fs.existsSync(p)) {
        result[key] = p;
        break;
      }
    }
  }
  return result;
}
function createSubInputPlugin(ide) {
  return {
    mode: "list",
    args: {
      placeholder: "\u641C\u7D22\u9879\u76EE\u540D\u79F0\u6216\u8DEF\u5F84...",
      enter: async (_action, callback) => {
        try {
          const projects = await readProjects(ide.dbPath);
          callback(projects.map((p) => ({
            title: p.name,
            description: p.path || p.uri,
            data: p.uri
          })));
        } catch (e) {
          callback([{ title: "\u26A0 \u8BFB\u53D6\u5931\u8D25", description: e?.message || String(e), data: "" }]);
        }
      },
      search: async (_action, word, callback) => {
        try {
          const projects = await readProjects(ide.dbPath);
          const q = word.toLowerCase().trim().split(/\s+/).filter(Boolean);
          const filtered = q.length === 0 ? projects : projects.filter(
            (p) => q.every((t) => p.name.toLowerCase().includes(t) || p.path.toLowerCase().includes(t))
          );
          callback(filtered.map((p) => ({
            title: p.name,
            description: p.path || p.uri,
            data: p.uri
          })));
        } catch (e) {
          callback([{ title: "\u26A0 \u8BFB\u53D6\u5931\u8D25", description: e?.message || String(e), data: "" }]);
        }
      },
      select: async (_action, item, _cb) => {
        if (!item.data) return;
        try {
          await openProject(ide.command, item.data, ide.shell);
          utools.hideMainWindow();
          utools.outPlugin();
        } catch (e) {
          alert(`\u6253\u5F00\u5931\u8D25: ${e?.message || e}`);
        }
      }
    }
  };
}
const BUILTIN_CODES = /* @__PURE__ */ new Set(["ideopen"]);
function refreshPlugins() {
  const ides = getIDEs();
  const currentCodes = new Set(ides.filter((i) => i.code).map((i) => i.code));
  for (const key of Object.keys(window.exports)) {
    if (!currentCodes.has(key) && !BUILTIN_CODES.has(key)) {
      delete window.exports[key];
    }
  }
  for (const ide of ides) {
    if (!ide.code || !ide.dbPath) continue;
    window.exports[ide.code] = createSubInputPlugin(ide);
  }
  registerFeatures();
}
const REG_CODES_KEY = "ide-registered-codes";
function registerFeatures() {
  const ides = getIDEs();
  const currentCodes = ides.filter((i) => i.code).map((i) => i.code);
  const prevCodes = utools.dbStorage.getItem(REG_CODES_KEY) || [];
  for (const ide of ides) {
    if (!ide.code) continue;
    try {
      utools.setFeature({
        code: ide.code,
        explain: `\u6253\u5F00 ${ide.name || ide.code} \u6700\u8FD1\u9879\u76EE`,
        cmds: [ide.code],
        icon: "logo.png"
      });
    } catch (e) {
      console.warn(`[ideOpen] \u274C \u6CE8\u518C ${ide.code} \u5931\u8D25:`, e);
    }
  }
  for (const oldCode of prevCodes) {
    if (!currentCodes.includes(oldCode)) {
      try {
        utools.removeFeature(oldCode);
      } catch (e) {
        console.warn(`[ideOpen] \u274C \u5220\u9664 feature ${oldCode} \u5931\u8D25:`, e);
      }
    }
  }
  utools.dbStorage.setItem(REG_CODES_KEY, currentCodes);
}
window.services = {
  readProjects,
  openProject,
  deleteProject,
  getIDEs,
  saveIDEs,
  refreshPlugins,
  registerFeatures,
  getPresets,
  getQuickFillPresets,
  detectPresetPaths,
  getAppDataPath: () => utools.getPath("appData"),
  getDefaultShell: () => defaultShell
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deleteProject,
  detectPresetPaths,
  getIDEs,
  getPresets,
  getQuickFillPresets,
  openProject,
  readProjects,
  refreshPlugins,
  registerFeatures,
  saveIDEs
});
