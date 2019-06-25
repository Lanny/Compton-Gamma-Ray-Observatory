const socket = io()

window.sendMessage = (eventName, payload) => {
  socket.emit(eventName, payload)
}

const player = document.getElementById('player-element')
const setTime = timestamp => player.currentTime = timestamp

const handlers = {
  setTime: e => {
    setTime(e.timestamp)
  },
  startPlayback: e => {
    setTime(e.timestamp)
    player.play()
  },
  stopPlayback: e => {
    setTime(e.timestamp)
    player.pause()
  }
}

for (let eventName in handlers) {
  socket.on(eventName, handlers[eventName])
}


const broadcastTime = () => {
  socket.emit('declareTime', { currentTime: player.currentTime })

  setTimeout(broadcastTime, 1000)
}

broadcastTime()


document.getElementById('cgro-play')
  .addEventListener('click', () => {
    socket.emit('reqStartPlayback', {
      currentTime: player.currentTime
    })
  })

document.getElementById('cgro-pause')
  .addEventListener('click', () => {
    player.pause()
    socket.emit('reqPausePlayback', {
      currentTime: player.currentTime
    })
  })
