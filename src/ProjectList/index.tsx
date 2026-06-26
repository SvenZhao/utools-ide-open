import { useEffect, useState, useRef } from 'react'
import { readProjects, openProject, type IDEItem } from '../store'
import './index.css'

export default function ProjectList({ ide, onBack }: { ide: IDEItem; onBack?: () => void }) {
  const [projects, setProjects] = useState<any[]>([])
  const [filtered, setFiltered] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ide.command || !ide.dbPath) {
      setError(`请先在设置页配置「${ide.name}」的数据文件路径`)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    readProjects(ide.dbPath)
      .then(items => { setProjects(items); setFiltered(items) })
      .catch((err: Error) => setError(`读取失败: ${err.message}`))
      .finally(() => setLoading(false))
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [ide.code])

  useEffect(() => {
    const q = search.toLowerCase().trim()
    if (!q) { setFiltered(projects); return }
    const terms = q.split(/\s+/)
    setFiltered(projects.filter((p: any) =>
      terms.every((t: string) =>
        p.name.toLowerCase().includes(t) || p.path.toLowerCase().includes(t) || p.label.toLowerCase().includes(t)
      )
    ))
    setSelected(-1)
  }, [search, projects])

  useEffect(() => {
    if (selected < 0 || !listRef.current) return
    const el = listRef.current.children[selected] as HTMLElement
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && selected >= 0) {
      handleSelect(filtered[selected])
    }
  }

  const handleSelect = async (project: any) => {
    try {
      await openProject(ide.command, project.uri, ide.shell)
      utools.hideMainWindow()
      utools.outPlugin()
    } catch (err: any) {
      alert(`打开失败: ${err.message}`)
    }
  }

  return (
    <div className='project-list' onKeyDown={handleKey}>
      <div className='top-bar'>
        {onBack && <button className='btn-back' onClick={onBack}>← 返回</button>}
        <span className='pl-ide-name'>{ide.name}</span>
        <span className='pl-count'>{filtered.length} 个项目</span>
      </div>

      <input ref={inputRef} className='pl-search' type='text' value={search}
        onChange={e => setSearch(e.target.value)} placeholder='搜索项目名称或路径...' />

      {loading && <div className='pl-loading'>加载中...</div>}

      {error && !loading && <div className='project-error'><p>{error}</p></div>}

      {!loading && !error && filtered.length === 0 && (
        <div className='pl-empty'>{search ? '没有匹配的项目' : '暂无最近项目'}</div>
      )}

      <div className='pl-items' ref={listRef}>
        {filtered.map((p, i) => (
          <div key={p.uri || i}
            className={`pl-item ${i === selected ? 'pl-item-selected' : ''}`}
            onClick={() => handleSelect(p)}
            onMouseEnter={() => setSelected(i)}>
            <div className='pl-item-icon'>{p.type === 'remote' ? '🌐' : p.type === 'workspace' ? '📄' : '📁'}</div>
            <div className='pl-item-info'>
              <div className='pl-item-name'>{p.name}</div>
              <div className='pl-item-path' title={p.path || p.uri}>{p.path || p.uri}</div>
            </div>
            {p.type === 'remote' && <span className='pl-item-badge'>远程</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
