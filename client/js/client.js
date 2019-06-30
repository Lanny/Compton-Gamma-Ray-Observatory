;(function() {
  const socket = io()
  const playerElement = document.getElementById('player-element')

  class PlayerViewModel {
    constructor(socket, playerElement) {
      this.socket = socket
      this.el = playerElement
      this.currentTime = ko.observable(0)
      this.playStatus = ko.observable('PAUSED')

      this.videoSrc = ko.observable('')
      /*
      this.currentTime = ko.observable('0:00')
      this.duration = ko.computed(() => {
        this.videoSrc()
      })
      */

      this.playPauseIcon = ko.computed(() => (
        {
          'PAUSED': '/static/svg/play-control.svg',
          'PLAYING': '/static/svg/pause-control.svg'
        }[this.playStatus()]
      ))

      this.socket.on('hello', this.onHello.bind(this))
      this.socket.on('changeSrc', this.onChangeSrc.bind(this))
      this.socket.on('setTime', this.onSetTime.bind(this))
      this.socket.on('startPlayback', this.onStartPlayback.bind(this))
      this.socket.on('stopPlayback', this.onStopPlayback.bind(this))
      this.socket.on('CGRO-ping', this.onPing.bind(this))
    }

    emit(eventName, event) {
      this.socket.emit(eventName, event)
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

    _setSrc(newSrc) {
      this.videoSrc(newSrc)
      this.el.load()
    }

    togglePlayState() {
      if (this.playStatus() === 'PLAYING') {
        this._pauseLocalPlayback()
        this.emit('reqPausePlayback', {
          currentTime: this.el.currentTime
        })
      } else if (this.playStatus() === 'PAUSED') {
        this.emit('reqStartPlayback', {
          currentTime: this.el.currentTime
        })
      }
    }

    requestChangeSource(newSrc) {
      this._pauseLocalPlayback()
      this.emit('reqChangeSrc', { src: newSrc })
    }

    onHello(e) {
      this._pauseLocalPlayback()

      this._setSrc(e.currentSrc)
      this._setTime(e.timestamp)

      if (e.playing)
        this._startLocalPlayback()
    }

    onChangeSrc(e) {
      this._pauseLocalPlayback()
      this._setSrc(e.src)
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
      this.emit('CGRO-pong', {
        seqId: e.seqId,
        currentTime: this.el.currentTime
      })
    }
  }

  const playerVM = new PlayerViewModel(socket, playerElement)
  ko.applyBindings(playerVM)

  window.cgroSocket = socket
  window.PVM = playerVM
})()
