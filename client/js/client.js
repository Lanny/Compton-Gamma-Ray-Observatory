;(function() {
  const socket = io()
  const playerElement = document.getElementById('player-element')

  function formatTimestamp(ts) {
    return `${~~(ts / 60)}:${('' + (~~ts % 60)).padStart(2, '0')}`
  }

  class FauxWindowViewModel {
    constructor(title, width, height, initialX, initialY) {
      this.fwTitle = ko.observable(title)

      if (!width) width = 300
      if (!height) height = 100
      if (!initialX)
        initialX = document.documentElement.clientWidth  / 2 - width / 2
      if (!initialY)
        initialY = document.documentElement.clientHeight  / 2 - height / 2 - 300

      this.fwWidth = ko.observable(width)
      this.fwHeight = ko.observable(height)
      this.fwX = ko.observable(initialX)
      this.fwY = ko.observable(initialY)
      this.fwDragging = ko.observable(false)
    }

    fwOnDrag(dX, dY) {
      this.fwX(this.windowDragBase[0] + dX)
      this.fwY(this.windowDragBase[1] + dY)
    }

    fwOnDragEnd() {
      this.fwDragging(false)
      this.windowDragBase = undefined
    }

    fwStartDrag(_, e) {
      this.fwDragging(true)
      this.windowDragBase = [this.fwX(), this.fwY()]
      this.signalDragStart(e.clientX, e.clientY)
    }
  }

  class PromptWindowViewModel extends FauxWindowViewModel {
    constructor(title, query) {
      super(title)
      this.fwTemplateName = 'prompt-template'
      this.query = query
      this.response = ko.observable('')
    }
  }

  class MasterViewModel {
    constructor(playerVM) {
      this.playerVM = playerVM
      this.subwindows = ko.observableArray()
      this.draggingWindow = ko.observable(null)
      this.subwindowLookup = {}
      this.dragBase = null
      this._idCounter = 1
    }

    addSubwindow(subwindow) {
      subwindow.id = this._idCounter++;
      subwindow.signalDragStart = (baseX, baseY) => {
        this.mouseDragBase = [baseX, baseY]
        this.draggingWindow(subwindow.id)
      }
      this.subwindowLookup[subwindow.id] = subwindow
      this.subwindows.push(subwindow)
    }

    onMouseMove(_, e) {
      if (!this.draggingWindow())
        return

      const dx = e.clientX - this.mouseDragBase[0]
      const dy = e.clientY - this.mouseDragBase[1]
      this.subwindowLookup[this.draggingWindow()].fwOnDrag(dx, dy)
    }

    onMouseUp() {
      if (!this.draggingWindow())
        return

      this.subwindowLookup[this.draggingWindow()].fwOnDragEnd()
      this.draggingWindow(null)
    }
  }

  class PlayerViewModel {
    constructor(socket, playerElement) {
      this.socket = socket
      this.el = playerElement
      this.currentTime = ko.observable(0)
      this.playStatus = ko.observable('PAUSED')

      this.videoSrc = ko.observable('')
      this.currentTime = ko.observable('0:00')
      this.duration = ko.observable('0:00')

      this.playPauseIcon = ko.computed(() => (
        {
          'PAUSED': '/static/svg/play-control.svg',
          'PLAYING': '/static/svg/pause-control.svg'
        }[this.playStatus()]
      ))

      this.el.addEventListener('durationchange', () => {
        this.duration(formatTimestamp(this.el.duration))
      })

      this.el.addEventListener('timeupdate', () => {
        this.currentTime(formatTimestamp(this.el.currentTime))
      })

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
  const masterVM = new MasterViewModel(playerVM)

  masterVM.addSubwindow(
    new PromptWindowViewModel(
      'Change Source', 'Enter the url of the new media source'))

  ko.applyBindings(masterVM)

  window.cgroSocket = socket
  window.PVM = playerVM
})()
