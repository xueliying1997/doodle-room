import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const publicDir = join(__dirname, 'public')
const port = Number(process.env.PORT || 4173)
const rooms = new Map()

const words = [
  '月亮', '披萨', '机器人', '雨伞', '火车', '恐龙', '吉他', '蛋糕', '足球', '飞机',
  '鲸鱼', '城堡', '雪人', '相机', '猫头鹰', '风筝', '蘑菇', '钥匙', '海盗船', '宇航员'
]

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
}

function cleanRoomCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 5; i += 1) result += alphabet[Math.floor(Math.random() * alphabet.length)]
  return rooms.has(result) ? makeRoomCode() : result
}

function nextWord() {
  return words[Math.floor(Math.random() * words.length)]
}

function makeRoom(code) {
  return {
    code,
    clients: new Map(),
    order: [],
    scores: new Map(),
    wrongCounts: new Map(),
    strokes: [],
    guesses: [],
    drawerId: '',
    word: nextWord(),
    roundEndsAt: Date.now() + 120_000,
    correctGuess: null,
    roundMessage: ''
  }
}

function getRoom(roomCode) {
  const key = cleanRoomCode(roomCode) || makeRoomCode()
  if (!rooms.has(key)) rooms.set(key, makeRoom(key))
  return rooms.get(key)
}

function publicClient(client) {
  return client ? { id: client.id, name: client.name } : null
}

function snapshot(room, clientId) {
  const drawer = room.clients.get(room.drawerId)
  const isDrawer = clientId === room.drawerId
  const scores = [...room.scores.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const wrongCount = room.wrongCounts.get(clientId) || 0
  return {
    code: room.code,
    strokes: room.strokes,
    guesses: room.guesses.slice(-12),
    players: room.clients.size,
    scores,
    drawer: publicClient(drawer),
    isDrawer,
    word: isDrawer ? room.word : '',
    wordHint: isDrawer ? room.word : `${room.word.length} 个字`,
    guessesLeft: isDrawer ? null : Math.max(0, 3 - wrongCount),
    roundEndsAt: room.roundEndsAt,
    correctGuess: room.correctGuess,
    roundMessage: room.roundMessage
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function sendEvent(res, name, data) {
  res.write(`event: ${name}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function broadcastSnapshot(room) {
  for (const client of room.clients.values()) {
    sendEvent(client.res, 'snapshot', snapshot(room, client.id))
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function chooseDrawer(room) {
  room.order = room.order.filter((id) => room.clients.has(id))
  if (!room.drawerId || !room.clients.has(room.drawerId)) {
    room.drawerId = room.order[0] || ''
  }
}

function nextRound(room, message = '') {
  room.order = room.order.filter((id) => room.clients.has(id))
  if (room.order.length > 0) {
    const currentIndex = Math.max(0, room.order.indexOf(room.drawerId))
    room.drawerId = room.order[(currentIndex + 1) % room.order.length]
  }
  room.strokes = []
  room.guesses = []
  room.wrongCounts = new Map()
  room.word = nextWord()
  room.correctGuess = null
  room.roundMessage = message
  room.roundEndsAt = Date.now() + 120_000
}

async function serveStatic(req, res) {
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
    res.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store'
    })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const room = getRoom(makeRoomCode())
    sendJson(res, 201, { code: room.code })
    return
  }

  const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(events|strokes|guess|clear|round|undo|qr))?$/i)
  if (match) {
    const room = getRoom(match[1])
    const action = match[2] || ''

    if (req.method === 'GET' && action === 'qr') {
      const requestedUrl = String(url.searchParams.get('url') || '').slice(0, 500)
      const forwardedProto = req.headers['x-forwarded-proto']
      const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'https'
      const shareUrl = requestedUrl || `${proto}://${req.headers.host}/?room=${room.code}`
      const QRCode = await import('qrcode')
      const svg = await QRCode.toString(shareUrl, {
        type: 'svg',
        margin: 1,
        width: 220,
        errorCorrectionLevel: 'M'
      })
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(svg)
      return
    }

    if (req.method === 'GET' && action === 'events') {
      const id = String(url.searchParams.get('clientId') || randomUUID()).slice(0, 80)
      const name = String(url.searchParams.get('name') || '玩家').slice(0, 24)
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      })
      room.clients.set(id, { id, name, res })
      if (!room.order.includes(id)) room.order.push(id)
      if (!room.scores.has(id)) room.scores.set(id, { id, name, score: 0 })
      else room.scores.get(id).name = name
      chooseDrawer(room)
      broadcastSnapshot(room)
      const heartbeat = setInterval(() => sendEvent(res, 'ping', { at: Date.now() }), 15_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        room.clients.delete(id)
        chooseDrawer(room)
        broadcastSnapshot(room)
      })
      return
    }

    if (req.method === 'POST' && action === 'strokes') {
      const data = await readBody(req)
      if (String(data.clientId || '') !== room.drawerId || room.correctGuess) {
        sendJson(res, 403, { ok: false, message: 'Only the drawer can draw this round.' })
        return
      }
      const stroke = {
        id: randomUUID(),
        clientId: String(data.clientId || '').slice(0, 80),
        color: String(data.color || '#111827').slice(0, 24),
        size: Math.max(1, Math.min(36, Number(data.size) || 6)),
        points: Array.isArray(data.points) ? data.points.slice(0, 800) : [],
        createdAt: Date.now()
      }
      if (stroke.points.length > 1) {
        room.strokes.push(stroke)
        for (const client of room.clients.values()) sendEvent(client.res, 'stroke', stroke)
      }
      sendJson(res, 201, { ok: true, stroke })
      return
    }

    if (req.method === 'POST' && action === 'guess') {
      const data = await readBody(req)
      const text = String(data.text || '').trim().slice(0, 40)
      const clientId = String(data.clientId || '').slice(0, 80)
      const player = String(data.player || '玩家').slice(0, 24)
      if (!text || clientId === room.drawerId || room.correctGuess) {
        sendJson(res, 200, { ok: true })
        return
      }
      const currentWrongCount = room.wrongCounts.get(clientId) || 0
      if (currentWrongCount >= 3) {
        sendJson(res, 200, { ok: false, exhausted: true })
        return
      }
      const correct = text.replace(/\s/g, '') === room.word.replace(/\s/g, '')
      const nextWrongCount = correct ? currentWrongCount : currentWrongCount + 1
      if (!correct) room.wrongCounts.set(clientId, nextWrongCount)
      const guess = {
        id: randomUUID(),
        player,
        text,
        correct,
        remaining: correct ? Math.max(0, 3 - currentWrongCount) : Math.max(0, 3 - nextWrongCount),
        createdAt: Date.now()
      }
      room.guesses.push(guess)
      if (correct && !room.correctGuess) {
        const guesserScore = room.scores.get(clientId) || { id: clientId, name: player, score: 0 }
        guesserScore.name = player
        guesserScore.score += 1
        room.scores.set(clientId, guesserScore)

        const guessedWord = room.word
        room.correctGuess = { player, word: guessedWord }
        nextRound(room, `${player} 猜对了「${guessedWord}」，自动进入下一轮。`)
      }
      if (!correct && nextWrongCount >= 3) {
        nextRound(room, `${player} 已经猜错 3 次，自动进入下一轮。`)
      }
      broadcastSnapshot(room)
      sendJson(res, 200, { ok: true, correct, guessesLeft: Math.max(0, 3 - nextWrongCount) })
      return
    }

    if (req.method === 'POST' && action === 'undo') {
      const data = await readBody(req)
      if (String(data.clientId || '') === room.drawerId) {
        room.strokes.pop()
        broadcastSnapshot(room)
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'clear') {
      const data = await readBody(req)
      if (String(data.clientId || '') === room.drawerId) {
        room.strokes = []
        broadcastSnapshot(room)
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'round') {
      nextRound(room)
      broadcastSnapshot(room)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'GET') {
      sendJson(res, 200, snapshot(room, url.searchParams.get('clientId') || ''))
      return
    }
  }

  await serveStatic(req, res)
})

server.listen(port, () => {
  console.log(`Doodle Room is running at http://localhost:${port}`)
})
