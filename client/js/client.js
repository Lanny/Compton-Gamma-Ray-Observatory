;(function() {
  const socket = io()
  const playerElement = document.getElementById('player-element')

  function formatTimestamp(ts) {
    return `${~~(ts / 60)}:${('' + (~~ts % 60)).padStart(2, '0')}`
  }

  function clamp(value, max, min) {
    return Math.max(Math.min(max, value), min)
  }

  class VolumeControlViewModel {
    constructor(videoEl, initialValue) {
      this.el = videoEl
      this.value = ko.observable()

      // Subscribe first so initialValue gets set
      this.value.subscribe(value =>  this.el.volume = value)
      this.value(initialValue)
      this.dbWidth = ko.computed(() => this.value() * 100 + '%')
    }

    startVolumeChange(_, e) {
      const bounds = e.target.getBoundingClientRect()
      const baseValue = (e.clientX - bounds.left) / bounds.width
      this.value(baseValue)
      masterVM.startDrag(e.clientX, e.clientY)
        .drag((dX) => {
          const value = baseValue + dX / bounds.width 
          this.value(clamp(value, 1, 0))
        })
    }
  }

  class FauxWindowViewModel {
    constructor(title, width, height, initialX, initialY) {
      this.fwTitle = ko.observable(title)

      if (!width) width = 300
      if (!height) height = 100
      if (!initialX)
        initialX = document.documentElement.clientWidth  / 2 - width / 2
      if (!initialY)
        initialY = document.documentElement.clientHeight  / 2 - height / 2

      this.fwWidth = ko.observable(width)
      this.fwHeight = ko.observable(height)
      this.fwX = ko.observable(initialX)
      this.fwY = ko.observable(initialY)
      this.fwDragging = ko.observable(false)
    }

    fwStartDrag(_, e) {
      this.windowDragBase = [this.fwX(), this.fwY()]
      this.fwDragging(true)

      masterVM.startDrag(e.clientX, e.clientY)
        .drag((dX, dY) => {
          this.fwX(this.windowDragBase[0] + dX)
          this.fwY(this.windowDragBase[1] + dY)
        })
        .dragEnd(() => {
          this.fwDragging(false)
          this.windowDragBase = undefined
        })
    }

    fwClose() {
      this.signalWindowClose()
    }
  }

  class PromptWindowViewModel extends FauxWindowViewModel {
    constructor(title, query) {
      super(title)
      this.fwTemplateName = 'prompt-template'
      this.query = query
      this.response = ko.observable('')
      this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve
        this.reject = reject
      })
    }

    onSubmit() {
      this.resolve(this.response())
      this.signalWindowClose()
    }

    fwClose() {
      this.reject()
      this.signalWindowClose()
    }
  }

  class MasterViewModel {
    constructor(playerVM) {
      this.playerVM = playerVM
      this.subwindows = ko.observableArray()
      this.activeDrag = ko.observable(null)
      this.subwindowLookup = {}
      this.dragBase = null
      this._idCounter = 1
    }

    addSubwindow(subwindow) {
      subwindow.id = this._idCounter++;
      subwindow.signalWindowClose = () => {
        this.subwindows.remove(sw => sw.id === subwindow.id)
      }
      this.subwindowLookup[subwindow.id] = subwindow
      this.subwindows.push(subwindow)
    }

    startDrag(baseX, baseY) {
      const drag = {
        _dragCB: () => null,
        _dragEndCB: () => null,
        drag: cb => (drag._dragCB = cb, drag),
        dragEnd: cb => (drag._dragEndCB = cb, drag),
        baseX,
        baseY,
      }

      this.activeDrag(drag)
      return drag
    }

    onMouseMove(_, e) {
      const drag = this.activeDrag()
      if (!drag) return

      const dx = e.clientX - drag.baseX
      const dy = e.clientY - drag.baseY

      drag._dragCB(dx, dy)
    }

    _endDrag() {
      const drag = this.activeDrag()
      if (!drag) return

      drag._dragEndCB()
      this.activeDrag(null)
    }
    onMouseUp() { this._endDrag() }
    onMouseLeave() { this._endDrag() }
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
      this.volumeControl = new VolumeControlViewModel(this.el, .5)

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

    startSimulatedBuffering(freq=3.0, duration=0.75, variance=0.2) {
      const genTime = base => base + (Math.random() - 0.5) * variance
      const pauseForBuffer = () => {
        this._pauseLocalPlayback()
        setTimeout(playAfterBuffer, genTime(duration) * 1000)
      }
      const playAfterBuffer = () => {
        this._startLocalPlayback()
        setTimeout(pauseForBuffer, genTime(freq) * 1000)
      }

      playAfterBuffer()
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

    promptForNewSource() {
      const prompt = new PromptWindowViewModel(
        'Change Source', 'Enter the url of the new media source')

      prompt
        .promise
        .then(newSrc => this.requestChangeSource(newSrc))
        .catch(() => undefined)
      masterVM.addSubwindow(prompt)
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

  ko.applyBindings(masterVM)

  window.cgroSocket = socket
  window.PVM = playerVM
})()
