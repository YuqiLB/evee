import { ConversationProvider } from '@elevenlabs/react'
import { store, useStore } from './state.js'
import { useEveeAgent, useDevHook } from './lib/agent.js'
import { Setup } from './screens/Setup.jsx'
import { Pitch } from './screens/Pitch.jsx'
import { Followup } from './screens/Followup.jsx'
import { FogBackground } from './components/FogBackground.jsx'
import { SensitivitySlider } from './components/SensitivitySlider.jsx'

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
  const zooming = useStore((s) => s.zooming)
  const agent = useEveeAgent()
  useDevHook()

  // The sensitivity slider lives here, not inside a screen, so it keeps its
  // bottom-left spot on both Setup and Pitch (Setup's zoom transform would
  // otherwise drag a fixed child along with it).
  if (screen === 'pitch')
    return (
      <>
        <Pitch agent={agent} />
        <SensitivitySlider tone="paper" />
      </>
    )
  // The fog sits behind Setup and Follow-up only. During the pitch the slide
  // stage is opaque, so the shader would burn GPU behind it for nothing.
  return (
    <div className={zooming ? 'scene zooming' : 'scene'}>
      <FogBackground />
      {screen === 'followup' ? <Followup agent={agent} /> : <Setup />}
      {screen === 'setup' && <SensitivitySlider tone="fog" />}
      {zooming && <div className="veil" aria-hidden="true" onAnimationEnd={enterPitch} />}
    </div>
  )
}

// The veil ends the zoom in the pitch's own background colour, so swapping in
// the Pitch screen underneath it is invisible; the slide then animates in.
function enterPitch() {
  store.reset()
  store.setState({ screen: 'pitch' })
}
