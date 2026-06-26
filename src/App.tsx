import { useEffect, useState } from 'react'
import Settings from './Settings'
import ProjectList from './ProjectList'
import { getIDEs, type IDEItem } from './store'

type View =
  | { page: 'settings' }
  | { page: 'projects'; ide: IDEItem }

export default function App() {
  const [view, setView] = useState<View>({ page: 'settings' })

  useEffect(() => {
    window.utools.onPluginEnter((action: { code: string }) => {
      if (action.code === 'ideopen') { setView({ page: 'settings' }); return }
      const ide = getIDEs().find(i => i.code === action.code)
      if (ide) setView({ page: 'projects', ide })
    })
  }, [])

  if (view.page === 'projects') return <ProjectList ide={view.ide} onBack={() => setView({ page: 'settings' })} />

  return <Settings />
}
