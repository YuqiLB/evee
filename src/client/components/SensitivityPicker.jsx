// Calm / Normal / Lively: how eagerly the screen follows the conversation.
// A native radio group, so arrow keys and screen readers work for free.
import { store, useStore } from '../state.js'
import { LEVELS, LEVEL_IDS } from '../lib/sensitivity.js'

export function SensitivityPicker() {
  const value = useStore((s) => s.sensitivity)
  return (
    <fieldset className="sensitivity">
      <legend>Sensitivity</legend>
      {LEVEL_IDS.map((id, i) => (
        <label key={id} className={value === id ? 'on' : ''}>
          <input
            type="radio"
            name="sensitivity"
            value={id}
            checked={value === id}
            onChange={() => store.setState({ sensitivity: id })}
          />
          {LEVELS[id].label}
          <kbd>{i + 1}</kbd>
        </label>
      ))}
    </fieldset>
  )
}
