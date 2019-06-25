const socket = io()

window.sendMessage = (eventName, payload) => {
  socket.emit(eventName, payload)
}

const player = document.getElementById('player-element')

socket.on('setTime', event => {
  player.currentTime = event.targetTime
})

const broadcastTime = () => {
  socket.emit('declareTime', { currentTime: player.currentTime })

  setTimeout(broadcastTime, 1000)
}

broadcastTime()


