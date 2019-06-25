#!/usr/bin/env node

const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const pug = require('pug')
const packageJson = require('../package.json')

const indexTemplate = pug.compileFile('templates/index.pug')

app.use('/static', express.static('client'))

app.get('/', (req, res) => {
  res.send(indexTemplate({ version: packageJson.version }))
})

io.on('connection', (socket) => {
  console.log('a user connected')

  socket.on('disconnect', () => {
    console.log('user disconnected')
  })

  socket.on('declareTime', function(msg) {
    console.log('time declared: ' + msg)
    socket.broadcast.emit('setTime', { targetTime: msg.currentTime })
  });
});

http.listen(8888, () => {
  console.log('listening on *:8888')
})
