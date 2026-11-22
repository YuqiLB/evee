import { ConversationProvider } from '@elevenlabs/react'
import { useStore } from './state.js'
import { useEveeAgent, useDevHook } from './lib/agent.js'
import { Setup } from './screens/Setup.jsx'
import { Pitch } from './screens/Pitch.jsx'
import { Followup } from './screens/Followup.jsx'
import { FogBackground } from './components/FogBackground.jsx'

// The provider sits above every screen so the live agent session survives the
// switch from Pitch to Follow-up (the agent asks for the email after the pitch).
export function App() {
  return (
    <ConversationProvider>
      <Screens />
    </ConversationProvider>
  )
}

function Screens() {
  const screen = useStore((s) => s.screen)
  const agent = useEveeAgent()
  useDevHook()

  if (screen === 'pitch') return <Pitch agent={agent} />
  // The fog sits behind Setup and Follow-up only. During the pitch the slide
  // stage is opaque, so the shader would burn GPU behind it for nothing.
  return (
    <>
      <FogBackground />
      {screen === 'followup' ? <Followup agent={agent} /> : <Setup />}
    </>
  )
}
