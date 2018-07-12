const EventEmitter = require('events')

class WebSocketAdapter extends EventEmitter {
    constructor(address) {
        super()
        try {
            console.log('Using existing `WebSocket` class')
            // If there is already a `WebSocket` object, it's probably being
            // loaded on browser and the only thing to do is to proxy the
            // HTML5 API to an event based API
            this.ws = new WebSocket(address)
            this.ws.binaryType = 'arraybuffer'
            this.ws.onopen = () => {
                this.emit('open')
            }
            this.ws.onclose = () => {
                this.emit('close')
            }
            this.ws.onmessage = (msg) => {
                this.emit('message', msg)
            }
            this.ws.onerror = (err) => {
                this.emit('error', err)
            }
            // this.ws.connect()
        } catch(error) {
            console.log('Using nodejs `ws` class')
            // If there is no `WebSocket` object, import the nodejs `ws` module
            // and proxy its events to the adapter.
            const WebSocket = require('ws')
            this.ws = new WebSocket(address)
            this.ws.binaryType = 'arraybuffer'
            this.ws.on('open', () => { this.emit('open') })
            this.ws.on('close', () => { this.emit('close') })
            this.ws.on('message', (msg) => { this.emit('message', msg) })
            this.ws.on('error', (error) => { this.emit('error', error) })
        }
    }
    send(msg) {
        this.ws.send(msg)
    }
    close() {
        this.ws.close()
    }
}

module.exports = WebSocketAdapter
