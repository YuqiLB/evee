// Tiny Express server. Each Wasp-style action is exposed as POST /api/<name>.
// Secrets are read here (from .env.server) and never sent to the browser.
import dotenv from 'dotenv'
dotenv.config({ path: '.env.server', quiet: true })

import express from 'express'
import { PrismaClient } from '@prisma/client'
import { startSession, saveSession } from '../src/server/session.js'
import { draftFollowup, sendFollowup } from '../src/server/followup.js'

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db'

const prisma = new PrismaClient()
// Same shape as Wasp's operation context, so the action files port unchanged.
const context = { entities: { Session: prisma.session } }

const actions = { startSession, saveSession, draftFollowup, sendFollowup }

const app = express()
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/:action', async (req, res) => {
  const fn = actions[req.params.action]
  if (!fn) return res.status(404).json({ error: 'unknown action' })
  try {
    res.json((await fn(req.body ?? {}, context)) ?? null)
  } catch (err) {
    console.error(`[${req.params.action}]`, err)
    res.status(err.statusCode ?? 500).json({ error: err.message })
  }
})

// API_PORT, not PORT: tools that launch `npm run dev` often set PORT for Vite.
const port = Number(process.env.API_PORT ?? 3001)
app.listen(port, () => console.log(`evee server on http://localhost:${port}`))
