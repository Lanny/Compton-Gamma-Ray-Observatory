#!/usr/bin/env node

const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const pug = require('pug')
const uuidv4 = require('uuid/v4')
const packageJson = require('../package.json')

const indexTemplate = pug.compileFile('templates/index.pug')

const MAX_DESYNC = 2.0
const PING_INTERVAL = 1.5
const LATENCY_MEASURES = 10
const TARGETING_WINDOW = 2.0

class Client {
  constructor(socket, room) {
    this.s = socket
    this.r = room
    this.id = uuidv4()

    this.pings = {}
    this.pingSeqId = 0
    this.latencyMeasures = []

    this.playbackReport = {
      measured: 0,
      timestamp: 0
    }

    this.s.on('disconnect', this.onDisconnect.bind(this))
    this.s.on('CGRO-pong', this.onPong.bind(this))
    this.s.on('reqStartPlayback', this.onReqStartPlayback.bind(this))
    this.s.on('reqPausePlayback', this.onReqPausePlayback.bind(this))
  }

  issuePing() {
    const now = Date.now()
    const seqId = this.pingSeqId++
    this.pings[seqId] = { sent: now }

    this.s.emit('CGRO-ping', {
      seqId,
      estLatency: this.estimateLatency()
    })
  }

  onPong(e) {
    const now = Date.now()
    const ping = this.pings[e.seqId]

    this.latencyMeasures.push(now - ping.sent)

    while (this.latencyMeasures.length > LATENCY_MEASURES) {
      this.latencyMeasures.shift()
    }

    delete this.pings[e.seqId]
  }

  estimateLatency() {
    let latency = 0
    for (var i=0; i<this.latencyMeasures.length; i++) {
      latency += this.latencyMeasures[i]
    }

    return latency / this.latencyMeasures.length
  }

  onDisconnect(e) {
    this.r.onDisconnect(this)
  }

  onReqStartPlayback(e) {
    this.playbackReport.measured = Date.now()
    this.playbackReport.timestamp = e.currentTime
    this.r.startPlayback(this, e.currentTime)
  }

  onReqPausePlayback(e) {
    this.playbackReport.measured = Date.now()
    this.playbackReport.timestamp = e.currentTime
    this.r.pausePlayback(this, e.currentTime)
  }
}

class Room {
  constructor(io) {
    this.io = io
    this.clients = {}
    this.clientCount = 0
    this.playbackStatus = {
      playing: false,
      mesured: 0,
      timestamp: 0
    }

    io.on('connection', this.onConnect.bind(this))
    this.poll()
  }

  onConnect(socket) {
    const client = new Client(socket, this);
    this.clients[client.id] = client;
    this.clientCount++

    console.log(`Client joined, currently ${this.clientCount} clients.`)
  }

  onDisconnect(client) {
    delete this.clients[client.id]
    this.clientCount--

    console.log(`Client left, currently ${this.clientCount} clients.`)
  }

  startPlayback(client, currentTime) {
    io.emit('startPlayback', {
      timestamp: currentTime
    })
  }

  pausePlayback(client, currentTime) {
    io.emit('stopPlayback', {
      timestamp: currentTime
    })
  }

  poll() {
    for (let clientId in this.clients) {
      this.clients[clientId].issuePing()
    }

    setTimeout(this.poll.bind(this), ~~(PING_INTERVAL * 1000))
  }

  staggeredBroadcast(cb) {
    const clients = []
    const latencies = []

    for (let clientId in this.clients) {
      clients.push(this.clients[clientId])
      latencies.push(client.estimateLatency())
    }

    const maxLatency = Math.max.apply(Math, latencies)
    const minLatency = Math.min.apply(Math, latencies)

    for (let i=0; i<clients.length; i++) {
      setTimeout(cb.bind(this, clients[i]), maxLatency - latencies[i])
    }
  }
}

app.use('/static', express.static('client'))

app.get('/', (req, res) => {
  res.send(indexTemplate({ version: packageJson.version }))
})

const room = new Room(io)

http.listen(8888, () => {
  console.log('listening on *:8888')
})
