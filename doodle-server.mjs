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
  '手机', '电脑', '耳机', '键盘', '鼠标', '电视', '冰箱', '洗衣机', '空调', '电风扇',
  '台灯', '手表', '相机', '雨伞', '书包', '铅笔', '剪刀', '牙刷', '杯子', '水壶',
  '椅子', '桌子', '沙发', '床', '镜子', '门', '窗户', '钟表', '蜡烛', '气球',
  '汽车', '公交车', '火车', '地铁', '飞机', '轮船', '自行车', '摩托车', '出租车', '救护车',
  '消防车', '警车', '校车', '卡车', '火箭', '热气球', '滑板', '电动车', '直升机', '潜水艇',
  '猫', '狗', '兔子', '老虎', '狮子', '大象', '长颈鹿', '熊猫', '猴子', '狐狸',
  '狼', '马', '牛', '羊', '猪', '鸡', '鸭子', '企鹅', '猫头鹰', '孔雀',
  '鱼', '鲸鱼', '海豚', '鲨鱼', '乌龟', '青蛙', '蛇', '鳄鱼', '蝴蝶', '蜜蜂',
  '蚂蚁', '蜘蛛', '蜗牛', '螃蟹', '章鱼', '海星', '恐龙', '独角兽', '龙', '考拉',
  '树', '花', '草', '仙人掌', '竹子', '蘑菇', '向日葵', '玫瑰', '荷花', '松树',
  '苹果', '香蕉', '西瓜', '草莓', '葡萄', '橙子', '菠萝', '桃子', '梨', '樱桃',
  '胡萝卜', '土豆', '西红柿', '玉米', '南瓜', '茄子', '辣椒', '白菜', '洋葱', '黄瓜',
  '披萨', '汉堡', '薯条', '蛋糕', '冰淇淋', '面包', '饺子', '面条', '寿司', '火锅',
  '鸡蛋', '牛奶', '咖啡', '可乐', '爆米花', '糖果', '巧克力', '粽子', '月饼', '热狗',
  '太阳', '月亮', '星星', '云', '彩虹', '闪电', '雪人', '火山', '山', '河流',
  '大海', '沙滩', '岛屿', '森林', '沙漠', '瀑布', '冰山', '石头', '贝壳', '树叶',
  '房子', '城堡', '学校', '医院', '超市', '餐厅', '公园', '游乐场', '电影院', '图书馆',
  '桥', '灯塔', '帐篷', '邮局', '银行', '机场', '车站', '农场', '动物园', '博物馆',
  '医生', '老师', '警察', '消防员', '厨师', '画家', '歌手', '司机', '宇航员', '运动员',
  '足球', '篮球', '乒乓球', '羽毛球', '棒球', '滑雪', '游泳', '跑步', '跳绳', '奖杯',
  '王冠', '宝箱', '钥匙', '机器人', '外星人', '魔法棒', '吉他', '钢琴', '鼓', '麦克风'
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
