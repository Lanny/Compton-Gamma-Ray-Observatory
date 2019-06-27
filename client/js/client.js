;(function() {
  const socket = io()
  const playerElement = document.getElementById('player-element')

  class PlayerViewModel {
    constructor(socket, playerElement) {
      this.socket = socket
      this.el = playerElement
      this.currentTime = ko.observable(0)
      this.playStatus = ko.observable('PAUSED')

      this.playPauseIcon = ko.computed(() => (
        {
          'PAUSED': '/static/svg/play-control.svg',
          'PLAYING': '/static/svg/pause-control.svg'
        }[this.playStatus()]
      ))

      this.socket.on('setTime', this.onSetTime.bind(this))
      this.socket.on('startPlayback', this.onStartPlayback.bind(this))
      this.socket.on('stopPlayback', this.onStopPlayback.bind(this))
      this.socket.on('CGRO-ping', this.onPing.bind(this))
    }

    _setTime(timestamp) {
      this.el.currentTime = timestamp
    }

    _startLocalPlayback() {
      this.el.play()
      this.playStatus('PLAYING')
    }

    _pauseLocalPlayback() {
      this.el.pause()
      this.playStatus('PAUSED')
    }

    togglePlayState() {
      if (this.playStatus() === 'PLAYING') {
        this._pauseLocalPlayback()
        socket.emit('reqPausePlayback', {
          currentTime: this.el.currentTime
        })
      } else if (this.playStatus() === 'PAUSED') {
        socket.emit('reqStartPlayback', {
          currentTime: this.el.currentTime
        })
      }
    }

    onSetTime(e) {
      this._setTime(e.timestamp)
    }

    onStartPlayback(e) {
      this._setTime(e.timestamp)
      this._startLocalPlayback()
    }

    onStopPlayback(e) {
      this._setTime(e.timestamp)
      this._pauseLocalPlayback()
    }

    onPing(e) {
      this.socket.emit('CGRO-pong', {
        seqId: e.seqId,
        currentTime: this.el.currentTime
      })
    }
  }

  const playerVM = new PlayerViewModel(socket, playerElement)
  ko.applyBindings(playerVM)
})()
