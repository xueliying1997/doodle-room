import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const publicDir = join(__dirname, 'public')
const port = Number(process.env.PORT || 4173)
const rooms = new Map()

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
}

function code(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 5; i += 1) result += alphabet[Math.floor(Math.random() * alphabet.length)]
  return rooms.has(result) ? newCode() : result
}

function prompt() {
  return ['画一座未来游乐场', '接力画一个外星厨房', '让大家猜：这是什么怪机器？', '三分钟内画出最离谱的海报', '每个人只加一笔，拼成一个故事'][
    Math.floor(Math.random() * 5)
  ]
}

function room(roomCode) {
  const key = code(roomCode) || newCode()
  if (!rooms.has(key)) {
    rooms.set(key, {
      code: key,
      clients: new Map(),
      strokes: [],
      votes: { keep: 0, chaos: 0, restart: 0 },
      roundEndsAt: Date.now() + 90_000,
      prompt: prompt()
    })
  }
  return rooms.get(key)
}

function snapshot(r) {
  return { code: r.code, strokes: r.strokes, votes: r.votes, roundEndsAt: r.roundEndsAt, prompt: r.prompt, players: r.clients.size }
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function event(res, name, data) {
  res.write(`event: ${name}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function broadcast(r, name, data) {
  for (const client of r.clients.values()) event(client.res, name, data)
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function staticFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const rawPath = url.pathname === '/' ? '/index.html' : url.pathname
  const safePath = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, '')
  const filePath = join(publicDir, safePath)
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  try {
    const content = await readFile(filePath)
    res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    json(res, 201, snapshot(room(newCode())))
    return
  }

  const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(events|strokes|vote|clear|round|undo))?$/i)
  if (match) {
    const r = room(match[1])
    const action = match[2] || ''

    if (req.method === 'GET' && action === 'events') {
      const id = randomUUID()
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      })
      r.clients.set(id, { res })
      event(res, 'snapshot', snapshot(r))
      broadcast(r, 'presence', { players: r.clients.size })
      const heartbeat = setInterval(() => event(res, 'ping', { at: Date.now() }), 15_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        r.clients.delete(id)
        broadcast(r, 'presence', { players: r.clients.size })
      })
      return
    }

    if (req.method === 'POST' && action === 'strokes') {
      const data = await body(req)
      const stroke = {
        id: randomUUID(),
        clientId: String(data.clientId || '').slice(0, 80),
        color: String(data.color || '#111827').slice(0, 24),
        size: Math.max(1, Math.min(36, Number(data.size) || 6)),
        player: String(data.player || 'Guest').slice(0, 24),
        points: Array.isArray(data.points) ? data.points.slice(0, 800) : [],
        createdAt: Date.now()
      }
      if (stroke.points.length > 1) {
        r.strokes.push(stroke)
        broadcast(r, 'stroke', stroke)
      }
      json(res, 201, { ok: true, stroke })
      return
    }

    if (req.method === 'POST' && action === 'undo') {
      const data = await body(req)
      const clientId = String(data.clientId || '').slice(0, 80)
      const reverseIndex = [...r.strokes].reverse().findIndex((stroke) => stroke.clientId === clientId)
      if (reverseIndex >= 0) r.strokes.splice(r.strokes.length - 1 - reverseIndex, 1)
      broadcast(r, 'snapshot', snapshot(r))
      json(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'vote') {
      const data = await body(req)
      const choice = ['keep', 'chaos', 'restart'].includes(data.choice) ? data.choice : 'keep'
      r.votes[choice] += 1
      broadcast(r, 'votes', r.votes)
      json(res, 200, { ok: true, votes: r.votes })
      return
    }

    if (req.method === 'POST' && action === 'clear') {
      r.strokes = []
      broadcast(r, 'clear', { ok: true })
      json(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'round') {
      r.strokes = []
      r.votes = { keep: 0, chaos: 0, restart: 0 }
      r.roundEndsAt = Date.now() + 90_000
      r.prompt = prompt()
      broadcast(r, 'snapshot', snapshot(r))
      json(res, 200, snapshot(r))
      return
    }

    if (req.method === 'GET') {
      json(res, 200, snapshot(r))
      return
    }
  }

  await staticFile(req, res)
})

server.listen(port, () => {
  console.log(`Doodle Room is running at http://localhost:${port}`)
})
