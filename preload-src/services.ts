import * as fs from 'node:fs'
import * as path from 'node:path'
import { exec, execSync, spawn, SpawnOptions } from 'node:child_process'

// ─── sql.js 原生加载（绕过 uTools 混合环境的 fetch 误判） ──

const WASM_DIR = path.join(__dirname, 'node_modules', 'sql.js', 'dist')

const sqlJsCode = fs.readFileSync(path.join(WASM_DIR, 'sql-wasm.js'), 'utf-8')
const initSqlJs: any = new Function(
  'require', 'module', 'exports',
  sqlJsCode + '\nreturn module.exports;'
)(require, { exports: {} }, {}).default || require

const wasmBinary = fs.readFileSync(path.join(WASM_DIR, 'sql-wasm.wasm'))

let _SQL: any = null
async function getSQL() {
  if (!_SQL) {
    _SQL = await initSqlJs({ wasmBinary })
  }
  return _SQL
}

// ─── 类型 ──

export interface IDEItem {
  code: string
  name: string
  command: string
  dbPath: string
  shell?: string
}

export interface ProjectItem {
  name: string
  path: string
  uri: string
  type: 'folder' | 'workspace' | 'remote'
  label: string
}

// ─── SQLite 读取 ──

const RECENT_KEYS = [
  'history.recentlyOpenedPathsList',
  'history.openedPathsList',
  'openedPathsList'
]

async function readProjectsFromSQLite(dbPath: string): Promise<ProjectItem[]> {
  const SQL = await getSQL()
  const candidates = [dbPath]
  // VSCode 共享存储 fallback
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && dbPath.includes(path.join('Code', 'User', 'globalStorage'))) {
    const shared = path.join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb')
    if (fs.existsSync(shared) && !candidates.includes(shared)) candidates.push(shared)
  }

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue
    const buffer = fs.readFileSync(filePath)
    const db = new SQL.Database(buffer)
    try {
      for (const key of RECENT_KEYS) {
        const results = db.exec(`SELECT value FROM ItemTable WHERE key = '${key}'`)
        if (results.length > 0 && results[0].values.length > 0) {
          const value = results[0].values[0][0] as string
          const data = JSON.parse(value)
          const entries: any[] = data.entries || []
          if (entries.length > 0) return parseEntries(entries)
        }
      }
    } finally {
      db.close()
    }
  }
  return []
}

// ─── JSON 读取 ──

async function readProjectsFromJSON(jsonPath: string): Promise<ProjectItem[]> {
  const content = fs.readFileSync(jsonPath, 'utf-8')
  const data = JSON.parse(content)
  const entries: any[] = data?.openedPathsList?.entries || []
  return parseEntries(entries)
}

// ─── XML 读取（JetBrains） ──

function readProjectsFromXML(xmlPath: string): ProjectItem[] {
  const content = fs.readFileSync(xmlPath, 'utf-8')

  const pathRe = /<option\s+value="([^"]+)"\s*\/>/g
  const paths: string[] = []
  let m: RegExpExecArray | null
  while ((m = pathRe.exec(content)) !== null) {
    const v = m[1]
    if (v.startsWith('/') || v.match(/^[A-Z]:\\/)) paths.push(v)
  }

  const nameByPath: Record<string, string> = {}
  const entryRe = /<entry\s+key="([^"]+)"[^>]*>[\s\S]*?<option\s+name="projectName"\s+value="([^"]+)"\s*\/>[\s\S]*?<\/entry>/g
  let n: RegExpExecArray | null
  while ((n = entryRe.exec(content)) !== null) {
    nameByPath[n[1]] = n[2]
  }

  return paths.map(p => ({
    name: nameByPath[p] || path.basename(p),
    path: p,
    uri: p,
    type: 'folder' as const,
    label: nameByPath[p] || ''
  }))
}

// ─── 统一解析 ──

function parseEntries(entries: any[]): ProjectItem[] {
  return entries
    .filter((e: any) => e != null && typeof e === 'object')
    .map((e: any) => {
      const uri = e.folderUri || e.fileUri || e.workspace?.configPath || ''
      if (!uri) return null
      const decoded = decodeURIComponent(uri)
      const name = path.basename(
        decoded.replace(/^file:\/\//, '').replace(/^vscode-remote:\/\//, '')
      )
      const isRemote = uri.startsWith('vscode-remote://')
      const isWorkspace = uri.endsWith('.code-workspace')
      const localPath = isRemote ? '' : uriToPath(uri)
      return {
        name: e.label || name || '未命名',
        path: localPath,
        uri,
        type: isRemote ? 'remote' as const : isWorkspace ? 'workspace' as const : 'folder' as const,
        label: e.label || ''
      }
    })
    .filter(Boolean) as ProjectItem[]
}

function uriToPath(uri: string): string {
  try {
    const url = new URL(uri)
    return decodeURIComponent(url.pathname)
  } catch {
    return uri
  }
}

// ─── 主入口 ──

export async function readProjects(filePath: string): Promise<ProjectItem[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`)
  }
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.vscdb' || ext === '.db') {
    return readProjectsFromSQLite(filePath)
  }
  if (ext === '.json') {
    return readProjectsFromJSON(filePath)
  }
  if (ext === '.xml') {
    return readProjectsFromXML(filePath)
  }
  try {
    return await readProjectsFromSQLite(filePath)
  } catch {
    return await readProjectsFromJSON(filePath)
  }
}

// ─── IDE 配置管理 ──

const STORAGE_KEY = 'vsc-ides'

export function getIDEs(): IDEItem[] {
  try {
    const data = utools.dbStorage.getItem(STORAGE_KEY)
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export function saveIDEs(ides: IDEItem[]) {
  utools.dbStorage.setItem(STORAGE_KEY, ides)
}

// ─── Shell 环境 ──

function getShellEnv(): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return process.env
  try {
    const shell = process.env.SHELL || 'zsh'
    const envStr = execSync(`${shell} -l -c env`, { encoding: 'utf-8', timeout: 3000 })
    const env = { ...process.env }
    envStr.split('\n').forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1)
    })
    return env
  } catch {
    return process.env
  }
}

// ─── 打开项目 ──

export function openProject(command: string, uri: string, shell?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWorkspace = uri.endsWith('.code-workspace')
    const flag = isWorkspace ? '--file-uri' : '--folder-uri'
    const env = getShellEnv()
    const child = spawn(command, [flag, uri], {
      shell: shell || true,
      env,
      stdio: 'ignore',
      windowsHide: true
    } as SpawnOptions)
    child.on('error', (err) => reject(new Error(`启动失败: ${err.message}`)))
    child.on('spawn', () => resolve())
    setTimeout(() => {
      if (child.exitCode === null) resolve()
    }, 3000)
  })
}

// ─── 预设 ──

export function getPresets() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const appData = utools.getPath('appData')
  const jetBrainsDir = path.join(home!, 'Library', 'Application Support', 'JetBrains')
  return {
    vscode: {
      name: 'VSCode',
      command: 'code',
      dbPaths: [
        path.join(home!, '.vscode-shared', 'sharedStorage', 'state.vscdb'),
        path.join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb'),
        path.join(appData, 'Code', 'storage.json')
      ]
    },
    cursor: {
      name: 'Cursor',
      command: 'cursor',
      dbPaths: [
        path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        path.join(appData, 'Cursor', 'storage.json')
      ]
    },
    vscodium: {
      name: 'VSCodium',
      command: 'codium',
      dbPaths: [
        path.join(appData, 'VSCodium', 'User', 'globalStorage', 'state.vscdb'),
        path.join(appData, 'VSCodium', 'storage.json')
      ]
    },
    idea: {
      name: 'IntelliJ IDEA',
      command: 'idea',
      dbPaths: [path.join(jetBrainsDir, 'IntelliJIdea*', 'options', 'recentProjects.xml')]
    },
    pycharm: {
      name: 'PyCharm',
      command: 'pycharm',
      dbPaths: [path.join(jetBrainsDir, 'PyCharm*', 'options', 'recentProjects.xml')]
    },
    webstorm: {
      name: 'WebStorm',
      command: 'webstorm',
      dbPaths: [path.join(jetBrainsDir, 'WebStorm*', 'options', 'recentProjects.xml')]
    },
    goland: {
      name: 'GoLand',
      command: 'goland',
      dbPaths: [path.join(jetBrainsDir, 'GoLand*', 'options', 'recentProjects.xml')]
    }
  }
}

export function getQuickFillPresets() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const appData = utools.getPath('appData')
  const jetBrainsDir = path.join(home!, 'Library', 'Application Support', 'JetBrains')
  // VSCode 新版使用共享存储，优先使用
  const vscDbPath = home
    ? path.join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb')
    : path.join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb')
  return [
    { code: 'vsc', name: 'VS Code', command: 'code', dbPath: vscDbPath },
    { code: 'cursor', name: 'Cursor', command: 'cursor', dbPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb') },
    { code: 'codium', name: 'VSCodium', command: 'codium', dbPath: path.join(appData, 'VSCodium', 'User', 'globalStorage', 'state.vscdb') },
    { code: 'idea', name: 'IntelliJ IDEA', command: 'idea', dbPath: jetBrainsDir + '/IntelliJIdea*/options/recentProjects.xml' },
    { code: 'pycharm', name: 'PyCharm', command: 'pycharm', dbPath: jetBrainsDir + '/PyCharm*/options/recentProjects.xml' },
    { code: 'webstorm', name: 'WebStorm', command: 'webstorm', dbPath: jetBrainsDir + '/WebStorm*/options/recentProjects.xml' },
    { code: 'goland', name: 'GoLand', command: 'goland', dbPath: jetBrainsDir + '/GoLand*/options/recentProjects.xml' }
  ]
}

export function detectPresetPaths() {
  const presets = getPresets()
  const result: Record<string, string> = {}
  for (const [key, preset] of Object.entries(presets)) {
    for (const p of preset.dbPaths) {
      if (fs.existsSync(p)) {
        result[key] = p
        break
      }
    }
  }
  return result
}

// ─── Sub-input 插件创建 ──

function createSubInputPlugin(ide: IDEItem) {
  return {
    mode: 'list',
    args: {
      placeholder: '搜索项目名称或路径...',
      enter: async (_action: any, callback: (items: any[]) => void) => {
        try {
          const projects = await readProjects(ide.dbPath)
          callback(projects.map(p => ({
            title: p.name,
            description: p.path || p.uri,
            data: p.uri
          })))
        } catch (e: any) {
          callback([{ title: '⚠ 读取失败', description: e?.message || String(e), data: '' }])
        }
      },
      search: async (_action: any, word: string, callback: (items: any[]) => void) => {
        try {
          const projects = await readProjects(ide.dbPath)
          const q = word.toLowerCase().trim().split(/\s+/).filter(Boolean)
          const filtered = q.length === 0 ? projects : projects.filter(p =>
            q.every(t => p.name.toLowerCase().includes(t) || p.path.toLowerCase().includes(t))
          )
          callback(filtered.map(p => ({
            title: p.name,
            description: p.path || p.uri,
            data: p.uri
          })))
        } catch (e: any) {
          callback([{ title: '⚠ 读取失败', description: e?.message || String(e), data: '' }])
        }
      },
      select: async (_action: any, item: any, _cb: any) => {
        if (!item.data) return
        try {
          await openProject(ide.command, item.data, ide.shell)
          utools.hideMainWindow()
          utools.outPlugin()
        } catch (e: any) {
          alert(`打开失败: ${e?.message || e}`)
        }
      }
    }
  }
}

const BUILTIN_CODES = new Set(['vscodeopen'])

export function refreshPlugins() {
  const ides = getIDEs()
  const currentCodes = new Set(ides.filter(i => i.code).map(i => i.code))

  // 删除已不存在的 sub-input handler（保留内置 code）
  for (const key of Object.keys(window.exports)) {
    if (!currentCodes.has(key) && !BUILTIN_CODES.has(key)) {
      delete (window.exports as any)[key]
    }
  }

  // 设置当前 handler
  for (const ide of ides) {
    if (!ide.code || !ide.dbPath) continue
    ;(window.exports as any)[ide.code] = createSubInputPlugin(ide)
  }

  registerFeatures()
}

// ─── 功能注册（供渲染进程调用） ──

const REG_CODES_KEY = 'vsc-registered-codes'

export function registerFeatures() {
  const ides = getIDEs()
  const currentCodes = ides.filter(i => i.code).map(i => i.code)
  const prevCodes: string[] = utools.dbStorage.getItem(REG_CODES_KEY) || []

  for (const ide of ides) {
    if (!ide.code) continue
    try {
      utools.setFeature({
        code: ide.code,
        explain: `打开 ${ide.name || ide.code} 最近项目`,
        cmds: [ide.code],
        icon: 'logo.png'
      })
    } catch (e) {
      console.warn(`[VscodeOpen] ❌ 注册 ${ide.code} 失败:`, e)
    }
  }

  for (const oldCode of prevCodes) {
    if (!currentCodes.includes(oldCode)) {
      try {
        utools.removeFeature(oldCode)
      } catch (e) {
        console.warn(`[VscodeOpen] ❌ 删除 feature ${oldCode} 失败:`, e)
      }
    }
  }

  utools.dbStorage.setItem(REG_CODES_KEY, currentCodes)
}

// ─── 暴露给渲染进程 ──

(window as any).services = {
  readProjects,
  openProject,
  getIDEs,
  saveIDEs,
  refreshPlugins,
  registerFeatures,
  getPresets,
  getQuickFillPresets,
  detectPresetPaths
}
