#!/usr/bin/env node

const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const pug = require('pug')
const uuidv4 = require('uuid/v4')
const packageJson = require('../package.json')

const indexTemplate = pug.compileFile('templates/index.pug')

class Client {
  constructor(socket, room) {
    this.s = socket
    this.r = room
    this.id = uuidv4()
    this.latencyMeasures = []
    this.playbackReport = {
      measured: 0,
      timestamp: 0
    }

    this.s.on('disconnect', this.onDisconnect.bind(this))
    this.s.on('reqStartPlayback', this.onReqStartPlayback.bind(this))
    this.s.on('reqPausePlayback', this.onReqPausePlayback.bind(this))
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
}

app.use('/static', express.static('client'))

app.get('/', (req, res) => {
  res.send(indexTemplate({ version: packageJson.version }))
})

const room = new Room(io)

http.listen(8888, () => {
  console.log('listening on *:8888')
})
