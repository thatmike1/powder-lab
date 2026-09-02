import WebSocket from 'ws'
const ws = new WebSocket('wss://powder.ssscribe.app/relay')
const t = setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 12000)
ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: 'probe' })))
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  console.log('GOT', m.type, m.room ?? '', m.seed ?? '')
  if (m.type === 'joined') { clearTimeout(t); ws.close(); process.exit(0) }
})
ws.on('error', (e) => { console.log('ERROR', e.message); process.exit(1) })
