// Calls a server action. In a Wasp port this file becomes
// `import { startSession, ... } from 'wasp/client/operations'`.
export async function callAction(name, args = {}) {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `${name} failed (${res.status})`)
  return data
}
