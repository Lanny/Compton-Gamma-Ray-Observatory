;(function() {
  const socket = io()
  const playerElement = document.getElementById('player-element')

  function pad(n) {
    return ('' + n).padStart(2, '0')
  }

  function formatTimestamp(ts) {
    const s = ~~ts % 60
    const m = ~~(ts / 60) % 60
    const h = ~~(ts / 3600)

    return `${h?h+':':''}${h?pad(m):m}:${pad(s)}`
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
      windowingVM.startDrag(e.clientX, e.clientY)
        .drag((dX) => {
          const value = baseValue + dX / bounds.width 
          this.value(clamp(value, 1, 0))
        })
    }
  }

  class FauxWindowViewModel {
    constructor(options) {
      let { title, width, height, initialX, initialY } = {
        title: 'Nameless Window',
        width: 300,
        height: 100,
        initialX: null,
        initialY: null,
        ...options
      }

      this.fwTitle = ko.observable(title)

      if (!initialX)
        initialX = document.documentElement.clientWidth  / 2 - width / 2
      if (!initialY)
        initialY = document.documentElement.clientHeight  / 2 - height / 2

      this.fwWidth = ko.observable(width)
      this.fwHeight = ko.observable(height)
      this.fwX = ko.observable(initialX)
      this.fwY = ko.observable(initialY)
      this.fwDragging = ko.observable(false)
      this.windowOrder = ko.observable(999)
    }

    fwStartDrag(_, e) {
      this.windowDragBase = [this.fwX(), this.fwY()]
      this.fwDragging(true)
      windowingVM.giveFocus(this)

      windowingVM.startDrag(e.clientX, e.clientY)
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

    onFocus() {
    }

    onFocusIn() {
      windowingVM.giveFocus(this)
    }

    afterRender()  {
    }

    onKeyDown(_, e) {
      if (e.keyCode === 27) {
        this.fwClose()
        return false
      }
      return true
    }
  }

  class PromptWindowViewModel extends FauxWindowViewModel {
    constructor({ query, ...options }) {
      super(options)
      this.fwTemplateName = 'prompt-template'
      this.query = query
      this.response = ko.observable('')
      this.inputHasFocus = ko.observable(false)
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

    afterRender() {
      FauxWindowViewModel.prototype.afterRender.apply(this, arguments)
      setTimeout(() => this.inputHasFocus(true), 0)
    }

    onFocus() {
      FauxWindowViewModel.prototype.onFocus.apply(this, arguments)
      setTimeout(() => this.inputHasFocus(true), 0)
    }
  }

  class PlaybackControlsViewModel extends FauxWindowViewModel {
    constructor(playerVM) {
      super({ title: 'Playback' })
      this.fwTemplateName = 'playback-controls-template'
      this.playerVM = playerVM
    }

    adjustTime(delta) {
      const newTime = this.playerVM.getCurrentTime() + delta
      this.playerVM.requestPlayFromTime(newTime)
    }
  }

  class SettingsViewModel extends FauxWindowViewModel {
    constructor(playerVM) {
      super({ title: 'Settings' })
      this.fwTemplateName = 'settings-template'
      this.playerVM = playerVM
    }
  }

  class MasterViewModel {
    constructor(windowingVM, playerVM) {
      this.playerVM = playerVM
      this.windowingVM = windowingVM
    }

    openPlaybackControls() {
      const playbackControlsViewModel = (
        new PlaybackControlsViewModel(this.playerVM)
      )

      windowingVM.addOrFocusTaggedSubwindow(
        'master.playbackControls',
        playbackControlsViewModel)
    }

    openSettings() {
      const settingsViewModel = (
        new SettingsViewModel(this.playerVM)
      )

      windowingVM.addOrFocusTaggedSubwindow(
        'master.settings',
        settingsViewModel)
    }
  }

  class WindowingViewModel {
    constructor() {
      this.subwindows = ko.observableArray()
      this.activeDrag = ko.observable(null)
      this.subwindowLookup = {}
      this.dragBase = null
      this._idCounter = 1
      this._windowTags = {}
    }

    giveFocus(subwindow) {
      if (subwindow.windowOrder() === 0) {
        // Subwindow already has focus
        return
      }

      const idx = this.subwindows.indexOf(subwindow)
      this.subwindows.splice(idx, 1)
      this.subwindows.push(subwindow)

      const len = this.subwindows().length
      this.subwindows().forEach((sw, i) => {
        sw.windowOrder(len - i - 1)
      })

      subwindow.onFocus()
    }

    addSubwindow(subwindow) {
      subwindow.id = this._idCounter++
      subwindow.signalWindowClose = () => {
        this.subwindows.remove(sw => sw.id === subwindow.id)
        delete this.subwindowLookup[subwindow.id]
      }
      this.subwindowLookup[subwindow.id] = subwindow
      this.subwindows.push(subwindow)
      this.giveFocus(subwindow)
    }

    isTaggedWindowAlive(tag) {
      if (tag in this._windowTags) {
        if (this._windowTags[tag].id in this.subwindowLookup) {
          return true
        }
      }

      return false
    }

    addOrFocusTaggedSubwindow(tag, subwindow) {
      if (tag in this._windowTags) {
        if (this._windowTags[tag].id in this.subwindowLookup) {
          this.giveFocus(this._windowTags[tag])
          return false
        } else {
          delete this._windowTags[tag]
        }
      }

      this.addSubwindow(subwindow)
      this._windowTags[tag] = subwindow
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
      this.currentTimeRaw = ko.observable(0)
      this.durationRaw = ko.observable(0)
      this.playStatus = ko.observable('PAUSED')
      this.bufferEnd = ko.observable(0)
      this.drawBufferHealth = ko.observable(false)

      this.videoSrc = ko.observable('')
      this.bufferHealth = ko.computed(() => {
        return `${this._currentBufferLength().toFixed(1)}s`
      })
      this.currentTime = ko.computed(
        () => formatTimestamp(this.currentTimeRaw()))
      this.duration = ko.computed(
        () => formatTimestamp(this.durationRaw()))
      this.volumeControl = new VolumeControlViewModel(this.el, .75)

      this.playPauseIcon = ko.computed(() => (
        {
          'PAUSED': '/static/svg/play-control.svg',
          'PLAYING': '/static/svg/pause-control.svg'
        }[this.playStatus()]
      ))

      this.el.addEventListener('durationchange', () => {
        this.durationRaw(this.el.duration)
      })

      this.el.addEventListener('timeupdate', () => {
        this.currentTimeRaw(this.el.currentTime)
      })

      this.socket.on('hello', this.onHello.bind(this))
      this.socket.on('changeSrc', this.onChangeSrc.bind(this))
      this.socket.on('setTime', this.onSetTime.bind(this))
      this.socket.on('startPlayback', this.onStartPlayback.bind(this))
      this.socket.on('stopPlayback', this.onStopPlayback.bind(this))
      this.socket.on('prepareToPlayFromTime', this.onPrepareToPlayFromTime.bind(this))
      this.socket.on('CGRO-ping', this.onPing.bind(this))

      this._update()
    }

    _update() {
      this.bufferEnd(this._getBufferEnd())
      setTimeout(this._update.bind(this), 1000)
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

    _setTime(timestamp, waitForBuffer, cb) {
      this.el.currentTime = timestamp

      if (waitForBuffer !== undefined) {
        const interval = setInterval( ()=> {
          if (this._currentBufferLength() >= waitForBuffer) {
            clearInterval(interval)
            cb()
          }
        }, 100)
      }
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

    getCurrentTime() {
      return this.el.currentTime
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
      const changeSourcePrompt = new PromptWindowViewModel({
        title: 'Change Source',
        query: 'Enter the url of the new media source'
      })

      changeSourcePrompt
        .promise
        .then(newSrc => {
          this.changeSourcePrompt = null
          this.requestChangeSource(newSrc)
        })
        .catch(() => this.changeSourcePrompt = null)

      windowingVM.addOrFocusTaggedSubwindow(
        'player.source-prompt',
        changeSourcePrompt)
    }

    requestChangeSource(newSrc) {
      this._pauseLocalPlayback()
      this.emit('reqChangeSrc', { src: newSrc })
    }

    requestPlayFromTime(timestamp) {
      this._pauseLocalPlayback()
      this.emit('reqPlayFromTime', { timestamp })
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

    onPrepareToPlayFromTime({ timestamp, readyId }) {
      this._setTime(timestamp, 1, () => {
        this.emit('ready', { readyId })
      })
    }

    onPing(e) {
      this.emit('CGRO-pong', {
        seqId: e.seqId,
        currentTime: this.el.currentTime
      })
    }

    _currentBufferLength() {
        return this.bufferEnd() - this.currentTimeRaw()
    }

    _getBufferEnd() {
      const idx = this._getCurrentBufferIndex()
      return (idx !== -1) ? this.el.buffered.end(idx) : 0
    }

    _getCurrentBufferIndex() {
      const cT = this.el.currentTime

      for (let i = 0; i<this.el.buffered.length; i++) {
        if (
          this.el.buffered.start(i) < cT &&
          this.el.buffered.end(i) >= cT
        ) {
          return i
        }
      }

      console.warn(`currentTime (${cT}) falls outside any buffered range`)
      return -1
    }
  }

  const playerVM = new PlayerViewModel(socket, playerElement)
  const windowingVM = new WindowingViewModel()
  const masterVM = new MasterViewModel(windowingVM, playerVM)

  ko.applyBindings(masterVM)

  window.cgroSocket = socket
  window.PVM = playerVM
})()
