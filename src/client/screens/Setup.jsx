// M1 stand-in: loads the fake context pack. Replaced by the real dropbox in M2.
import { store } from '../state.js'
import { FAKE_PACK } from '../lib/context.js'

export function Setup() {
  function start() {
    store.reset()
    store.setState({ chunks: FAKE_PACK.chunks, images: FAKE_PACK.images, screen: 'pitch' })
  }
  return (
    <main className="setup">
      <button className="primary" onClick={start}>
        [start button label]
      </button>
    </main>
  )
}
