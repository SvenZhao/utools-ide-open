import { useEffect, useState } from 'react'
import Settings from './Settings'
import ProjectList from './ProjectList'
import { getIDEs, type IDEItem } from './store'

type View =
  | { page: 'home' }
  | { page: 'settings' }
  | { page: 'projects'; ide: IDEItem }

export default function App() {
  const [view, setView] = useState<View>({ page: 'home' })

  useEffect(() => {
    window.utools.onPluginEnter((action: { code: string }) => {
      if (action.code === 'vscodeopen') {
        setView({ page: 'home' })
        return
      }
      const ide = getIDEs().find(i => i.code === action.code)
      if (ide) setView({ page: 'projects', ide })
    })
  }, [])

  if (view.page === 'settings') return <Settings onBack={() => setView({ page: 'home' })} />
  if (view.page === 'projects') return <ProjectList ide={view.ide} onBack={() => setView({ page: 'home' })} />

  const ides = getIDEs()

  return (
    <div className='app-home'>
      <h2>VscodeOpen <span className='subtitle'>已配置的 IDE</span></h2>

      {ides.length === 0 && (
        <p className='empty-hint'>还没有配置 IDE，点下方按钮添加</p>
      )}

      {ides.map((ide, i) => (
        <div key={i} className='ide-card' onClick={() => setView({ page: 'projects', ide })}>
          <div className='ide-card-left'>
            <span className='ide-card-code'>{ide.code}</span>
            <span className='ide-card-name'>{ide.name}</span>
          </div>
          <span className='ide-card-arrow'>→</span>
        </div>
      ))}

      <button className='btn-add-ide' onClick={() => setView({ page: 'settings' })}>+ 新增配置</button>
    </div>
  )
}
