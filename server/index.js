#!/usr/bin/env node

const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const pug = require('pug')
const uuidv4 = require('uuid/v4')
const packageJson = require('../package.json')

const indexTemplate = pug.compileFile('templates/index.pug')

const MAX_DESYNC = 1.0
const PING_INTERVAL = 1.5
const PEER_STATUS_INTERVAL = 1.5
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
      measured: Date.now(),
      timestamp: 0
    }

    this.s.on('disconnect', this.onDisconnect.bind(this))
    this.s.on('CGRO-pong', this.onPong.bind(this))
    this.s.on('reqStartPlayback', this.onReqStartPlayback.bind(this))
    this.s.on('reqPausePlayback', this.onReqPausePlayback.bind(this))
    this.s.on('reqChangeSrc', this.onReqChangeSrc.bind(this))
    this.s.on('ready', this.onReady.bind(this))
    this.s.on(
      'reqPlayFromTime',
      ({ timestamp }) => this.r.playFromTime(timestamp)
    )
  }

  sendEvent(eventName, event) {
    this.s.emit(eventName, event)
  }

  issuePing() {
    const now = Date.now()
    const seqId = this.pingSeqId++
    this.pings[seqId] = { sent: now }

    this.sendEvent('CGRO-ping', {
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

    this.playbackReport.measured = now
    this.playbackReport.timestamp = e.currentTime

    delete this.pings[e.seqId]
  }

  estimateLatency() {
    let latency = 0
    for (var i=0; i<this.latencyMeasures.length; i++) {
      latency += this.latencyMeasures[i]
    }

    return latency / this.latencyMeasures.length
  }

  estimatePlaybackTime(playing, now=null) {
    const { measured, timestamp } = this.playbackReport
    if (now === null)
      now = Date.now()

    const deltaTime = playing ? (now - measured) : 0
    return timestamp + deltaTime / 1000
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

  onReqChangeSrc(e) {
    this.r.changeSrc(e.src)
  }

  onReady(e) {
    this.r.clientReady(this, e)
  }
}

class Room {
  constructor(io) {
    this.io = io
    this.clients = {}
    this.pendingReadies = {}
    this.clientCount = 0
    this.currentSrc = ''
    this.playbackStatus = {
      playing: false,
      mesured: 0,
      timestamp: 0
    }

    io.on('connection', this.onConnect.bind(this))
    this._updatePlaybackStatus(0, false)

    this.poll()
    this.peerStatusBroadcast()
  }

  _emit(eventName, data) {
    this.io.emit(eventName, data)
  }

  _mapClients(cb) {
    const ret = []
    for (let clientId in this.clients) {
      ret.push(cb(this.clients[clientId]))
    }
    return ret
  }

  _updatePlaybackStatus(timestamp, playing, now) {
    if (now === undefined)
      now = Date.now()

    this.playbackStatus.measured = now
    this.playbackStatus.timestamp = timestamp
    this.playbackStatus.playing = playing
  }

  _getCurrentTime() {
    const { playing, measured, timestamp } = this.playbackStatus
    if (playing) {
      return timestamp + (Date.now() - measured) / 1000.0
    } else {
      return timestamp
    }
  }

  _getStatus() {
    return {
      currentSrc: this.currentSrc,
      playing: this.playbackStatus.playing,
      timestamp: this._getCurrentTime()
    }
  }

  _estimateDesync() {
    const now = Date.now()
    const playbackTimes = this._mapClients(
      c => c.estimatePlaybackTime(this.playbackStatus.playing, now))
    console.log(playbackTimes)
  }

  _waitForReady(eventName, data) {
    return (new Promise((res, rej) => {
      const readyId = uuidv4()

      this.pendingReadies[readyId] = {
        numPending: Object.keys(this.clients).length,
        readyClients: [],
        readyId,
        res,
        rej
      }

      this._emit(eventName, { readyId, ...data })
    }))
  }

  onConnect(socket) {
    const client = new Client(socket, this);
    this.clients[client.id] = client;
    this.clientCount++

    client.sendEvent('hello', this._getStatus())
    console.log(`Client joined, currently ${this.clientCount} clients.`)
  }

  onDisconnect(client) {
    delete this.clients[client.id]
    this.clientCount--

    console.log(`Client left, currently ${this.clientCount} clients.`)
  }

  clientReady(client, { readyId }) {
    const ready = this.pendingReadies[readyId]
    if (!ready) {
      console.warn(`No pending ready with id ${readyId}`)
      return
    }

    ready.readyClients.push(client)
    --ready.numPending

    if (ready.numPending < 1) {
      ready.res()
      delete this.pendingReadies[readyId]
    }
  }

  startPlayback(client, currentTime) {
    this._updatePlaybackStatus(currentTime, true)
    this._emit('startPlayback', {
      timestamp: currentTime
    })
  }

  pausePlayback(client, currentTime) {
    this._updatePlaybackStatus(currentTime, false)
    this._emit('stopPlayback', {
      timestamp: currentTime
    })
  }

  playFromTime(timestamp) {
    this._waitForReady('prepareToPlayFromTime', { timestamp })
      .then(() => {
        this.staggeredBroadcast(client => {
          client.sendEvent('startPlayback', { timestamp: timestamp })
        })
      })
  }

  changeSrc(newSrc) {
    this.currentSrc = newSrc
    this.playbackStatus.playing = false
    this.playbackStatus.measured = Date.now()
    this.playbackStatus.timestamp = 0

    io.emit('changeSrc', { 'src': newSrc })
  }

  poll() {
    this._estimateDesync()

    for (let clientId in this.clients) {
      this.clients[clientId].issuePing()
    }

    setTimeout(this.poll.bind(this), ~~(PING_INTERVAL * 1000))
  }

  peerStatusBroadcast() {
    const peers = this._mapClients(client => ({
      id: client.id,
      latency: client.estimateLatency(),
      playbackTime: client.estimatePlaybackTime(),
    }))

    this._mapClients(client => {
      client.sendEvent('peerStatus', { yourId: client.id, peers })
    })

    setTimeout(
      this.peerStatusBroadcast.bind(this),
      ~~(PEER_STATUS_INTERVAL * 1000))
  }

  staggeredBroadcast(cb) {
    const clients = []
    const latencies = []

    for (let clientId in this.clients) {
      const client = this.clients[clientId]
      clients.push(client)
      latencies.push(client.estimateLatency())
    }

    const maxLatency = Math.max.apply(Math, latencies)
    const minLatency = Math.min.apply(Math, latencies)

    for (let i=0; i<clients.length; i++) {
      setTimeout(cb.bind(this, clients[i]), maxLatency - latencies[i])
    }
  }
}

app.use('/static', express.static('./client'))

app.get('/', (req, res) => {
  res.send(indexTemplate({ version: packageJson.version }))
})

const room = new Room(io)

http.listen(8888, () => {
  console.log('listening on *:8888')
})
