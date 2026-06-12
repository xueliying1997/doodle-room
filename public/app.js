const canvas = document.querySelector('#board')
const ctx = canvas.getContext('2d')
const roomInput = document.querySelector('#roomInput')
const joinBtn = document.querySelector('#joinBtn')
const newRoomBtn = document.querySelector('#newRoomBtn')
const promptText = document.querySelector('#promptText')
const timerText = document.querySelector('#timerText')
const playersText = document.querySelector('#playersText')
const connectionText = document.querySelector('#connectionText')
const sizeInput = document.querySelector('#sizeInput')
const undoBtn = document.querySelector('#undoBtn')
const clearBtn = document.querySelector('#clearBtn')
const exportBtn = document.querySelector('#exportBtn')
const roundBtn = document.querySelector('#roundBtn')
const voteKeep = document.querySelector('#voteKeep')
const voteChaos = document.querySelector('#voteChaos')
const voteRestart = document.querySelector('#voteRestart')

const state = {
  room: new URLSearchParams(location.search).get('room') || '',
  color: '#111827',
  size: 6,
  strokes: [],
  currentStroke: null,
  eventSource: null,
  reconnectTimer: null,
  roundEndsAt: Date.now() + 90_000,
  player: `玩家${Math.floor(100 + Math.random() * 900)}`,
  clientId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())
}

function normalizeRoom(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

async function postJson(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json()
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect()
  const scale = window.devicePixelRatio || 1
  const width = Math.max(320, Math.floor(rect.width * scale))
  const height = Math.max(240, Math.floor(rect.height * scale))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
    drawAll()
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
}

function drawPaper() {
  ctx.fillStyle = '#fbfcff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const grid = 32 * (window.devicePixelRatio || 1)
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.08)'
  ctx.lineWidth = 1
  for (let x = 0; x < canvas.width; x += grid) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, canvas.height)
    ctx.stroke()
  }
  for (let y = 0; y < canvas.height; y += grid) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
  }
}

function drawStroke(stroke) {
  if (!stroke.points || stroke.points.length < 2) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.size * (window.devicePixelRatio || 1)
  ctx.beginPath()
  const first = stroke.points[0]
  ctx.moveTo(first.x * canvas.width, first.y * canvas.height)
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * canvas.width, point.y * canvas.height)
  ctx.stroke()
  ctx.restore()
}

function drawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawPaper()
  for (const stroke of state.strokes) drawStroke(stroke)
  if (state.currentStroke) drawStroke(state.currentStroke)
}

function startStroke(event) {
  canvas.setPointerCapture(event.pointerId)
  state.currentStroke = {
    clientId: state.clientId,
    color: state.color,
    size: state.size,
    player: state.player,
    points: [canvasPoint(event)]
  }
  drawAll()
}

function moveStroke(event) {
  if (!state.currentStroke) return
  const point = canvasPoint(event)
  const points = state.currentStroke.points
  const last = points[points.length - 1]
  if (Math.hypot(point.x - last.x, point.y - last.y) < 0.002) return
  points.push(point)
  drawAll()
}

async function endStroke() {
  if (!state.currentStroke) return
  const stroke = state.currentStroke
  state.currentStroke = null
  if (stroke.points.length > 1) await postJson(`/api/rooms/${state.room}/strokes`, stroke)
}

function updateVotes(votes) {
  voteKeep.textContent = String(votes.keep || 0)
  voteChaos.textContent = String(votes.chaos || 0)
  voteRestart.textContent = String(votes.restart || 0)
}

function applySnapshot(snapshot) {
  state.room = snapshot.code
  state.strokes = snapshot.strokes || []
  state.roundEndsAt = snapshot.roundEndsAt || Date.now()
  roomInput.value = state.room
  promptText.textContent = snapshot.prompt || '自由涂鸦'
  playersText.textContent = String(snapshot.players || 1)
  updateVotes(snapshot.votes || {})
  history.replaceState(null, '', `?room=${state.room}`)
  drawAll()
}

function connect(room) {
  state.room = normalizeRoom(room)
  if (!state.room) return
  if (state.eventSource) state.eventSource.close()
  clearTimeout(state.reconnectTimer)
  connectionText.textContent = '连接中'
  const source = new EventSource(`/api/rooms/${state.room}/events`)
  state.eventSource = source
  source.addEventListener('open', () => {
    connectionText.textContent = '已连接'
  })
  source.addEventListener('snapshot', (event) => {
    applySnapshot(JSON.parse(event.data))
    connectionText.textContent = '已连接'
  })
  source.addEventListener('stroke', (event) => {
    const stroke = JSON.parse(event.data)
    if (!state.strokes.some((item) => item.id === stroke.id)) {
      state.strokes.push(stroke)
      drawAll()
    }
  })
  source.addEventListener('votes', (event) => updateVotes(JSON.parse(event.data)))
  source.addEventListener('clear', () => {
    state.strokes = []
    drawAll()
  })
  source.addEventListener('presence', (event) => {
    playersText.textContent = String(JSON.parse(event.data).players || 1)
  })
  source.addEventListener('error', () => {
    connectionText.textContent = '重连中'
    source.close()
    state.reconnectTimer = setTimeout(() => connect(state.room), 1200)
  })
}

async function createRoom() {
  const created = await postJson('/api/rooms')
  connect(created.code)
}

function tickTimer() {
  const remaining = Math.max(0, state.roundEndsAt - Date.now())
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  timerText.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function exportPng() {
  const link = document.createElement('a')
  link.download = `doodle-${state.room || 'room'}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

document.querySelectorAll('.swatch').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('.swatch.active')?.classList.remove('active')
    button.classList.add('active')
    state.color = button.dataset.color
  })
})

sizeInput.addEventListener('input', () => {
  state.size = Number(sizeInput.value)
})
joinBtn.addEventListener('click', () => connect(roomInput.value))
roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') connect(roomInput.value)
})
roomInput.addEventListener('input', () => {
  roomInput.value = normalizeRoom(roomInput.value)
})
newRoomBtn.addEventListener('click', createRoom)
undoBtn.addEventListener('click', () => postJson(`/api/rooms/${state.room}/undo`, { clientId: state.clientId }))
clearBtn.addEventListener('click', async () => {
  state.strokes = []
  drawAll()
  await postJson(`/api/rooms/${state.room}/clear`)
})
exportBtn.addEventListener('click', exportPng)
roundBtn.addEventListener('click', () => postJson(`/api/rooms/${state.room}/round`))
document.querySelectorAll('[data-vote]').forEach((button) => {
  button.addEventListener('click', () => postJson(`/api/rooms/${state.room}/vote`, { choice: button.dataset.vote }))
})

canvas.addEventListener('pointerdown', startStroke)
canvas.addEventListener('pointermove', moveStroke)
canvas.addEventListener('pointerup', endStroke)
canvas.addEventListener('pointercancel', endStroke)
window.addEventListener('resize', resizeCanvas)

resizeCanvas()
setInterval(tickTimer, 250)
if (state.room) connect(state.room)
else createRoom()
