const EventEmitter = require('events')
const WebSocketAdapter = require('./websocketadapter.js')

class WebsocketConnection extends EventEmitter {
    constructor() {
        super()
        this.binaryState = 0
        this.sendFileName = ''
        this.sendFileData = new ArrayBuffer()
        this.getFileName = ''
        this.getFileData = new ArrayBuffer()
        this.STOP = '\r\x03' // CTRL-C 2x
        this.RESET = '\r\x04' // CTRL-D
        this.ENTER_RAW_REPL = '\r\x01' // CTRL-A
        this.EXIT_RAW_REPL = '\r\x04\r\x02' // CTRL-D + CTRL-B
    }
    /**
    * List all available WebREPL addresses
    * @return {Promise} Resolves with an array of available WebREPL addresses
    */
    static listAvailable() {
        // TODO: Find a way to list all the possible WebREPL ips on your network
        return Promise.resolve([])
    }
    /**
    * Opens a connection given an ip address and a password.
    * @param {String} ip Ip address without protocols or ports
    * @param {String} password MicroPython's WebREPL password
    */
    open(ip, password) {
        this.ip = ip
        this.password = password
        this.ws = new WebSocketAdapter(`ws://${ip}:8266`)
        this.ws.on('open', () => {
            this.ws.on('message', this._handleMessage.bind(this))
        })
        this.ws.on('close', () => {
            this.emit('disconnected')
        })
    }
    /**
    * Closes current connection.
    */
    close() {
        this.emit('disconnected')
        if (this.ws) {
            this.ws.close()
        }
    }
    /**
    * Executes code in a string format. This code can contain multiple lines.
    * @param {String} code String of code to be executed. Line breaks must be `\n`
    */
    execute(code) {
        let interval = 30
        let page = 80
        let enterRawRepl = () => {
            return new Promise((resolve) => {
                this._enterRawRepl()
                setTimeout(() => {
                    resolve()
                }, interval*2)
            })
        }
        let executeRaw = () => {
            return new Promise((resolve, reject) => {
                let lines = code.split('\n')
                let t = 0
                this.emit('output', `\r\n`)
                for(let i = 0; i < lines.length; i++) {
                    let line = lines[i]
                    if (line.length < page) {
                        t += lines[i].length
                        setTimeout(() => {
                            this.evaluate(line+'\n')
                            this.emit('output', `.`)
                        }, t)
                    } else {
                        for(let j = 0; j < Math.ceil(line.length / page); j++) {
                            t += page
                            setTimeout(() => {
                                this.evaluate(line.substr(j*1024, 1024))
                                this.emit('output', `.`)
                            }, t)
                        }
                    }
                }
                setTimeout(() => {
                    resolve()
                }, t+100)
            })
        }
        let exitRawRepl = () => {
            this._exitRawRepl()
            return Promise.resolve()
        }
        return enterRawRepl()
            .then(executeRaw)
            .then(exitRawRepl)
    }
    /**
    * Evaluate a command/expression.
    * @param {String} command Command/expression to be evaluated
    */
    evaluate(command) {
        this.ws.send(command)
    }
    /**
    * Send a "stop" command in order to interrupt any running code. For serial
    * REPL this command is "CTRL-C".
    */
    stop() {
        this.evaluate(this.STOP)
    }
    /**
    * Send a command to "soft reset".
    */
    softReset() {
        this.stop()
        this.evaluate(this.RESET)
    }
    /**
    * Prints on console the existing files on file system.
    */
    listFiles() {
        const code = `print(' ')
from os import listdir
print(listdir())
`
        this.execute(code)
    }
    /**
    * Prints on console the content of a given file.
    * @param {String} path File's path
    */
    loadFile(path) {
        // WEBREPL_FILE = "<2sBBQLH64s"
        let rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
        rec[0] = 'W'.charCodeAt(0);
        rec[1] = 'A'.charCodeAt(0);
        rec[2] = 2; // get
        rec[3] = 0;
        rec[4] = 0; rec[5] = 0; rec[6] = 0; rec[7] = 0; rec[8] = 0; rec[9] = 0; rec[10] = 0; rec[11] = 0;
        rec[12] = 0; rec[13] = 0; rec[14] = 0; rec[15] = 0;
        rec[16] = path.length & 0xff; rec[17] = (path.length >> 8) & 0xff;
        for (let i = 0; i < 64; ++i) {
            if (i < path.length) {
                rec[18 + i] = path.charCodeAt(i);
            } else {
                rec[18 + i] = 0;
            }
        }

        // initiate get
        this.binaryState = 21;
        this.getFileName = path;
        this.getFileData = new Uint8Array(0);
        this.evaluate(rec);
    }
    /**
    * Writes a given content to a file in the file system.
    * @param {String} path File's path
    * @param {String} content File's content
    */
    writeFile(path, content) {
        // This looks wrong but it will be used later on by `_handleMessage`
        this.sendFileName = path
        let buff = new Uint8Array(content.length)
        for( let i = 0; i < content.length; i++) {
            buff[i] = content.charCodeAt(i);
        }
        this.sendFileData = buff

        let dest_fname = this.sendFileName
        let dest_fsize = this.sendFileData.length

        // WEBREPL_FILE = "<2sBBQLH64s"
        let rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64)
        rec[0] = 'W'.charCodeAt(0)
        rec[1] = 'A'.charCodeAt(0)
        rec[2] = 1 // put
        rec[3] = 0
        rec[4] = 0; rec[5] = 0; rec[6] = 0; rec[7] = 0; rec[8] = 0; rec[9] = 0; rec[10] = 0; rec[11] = 0;
        rec[12] = dest_fsize & 0xff; rec[13] = (dest_fsize >> 8) & 0xff; rec[14] = (dest_fsize >> 16) & 0xff; rec[15] = (dest_fsize >> 24) & 0xff;
        rec[16] = dest_fname.length & 0xff; rec[17] = (dest_fname.length >> 8) & 0xff;
        for (let i = 0; i < 64; ++i) {
            if (i < dest_fname.length) {
                rec[18 + i] = dest_fname.charCodeAt(i)
            } else {
                rec[18 + i] = 0
            }
        }

        // initiate put
        this.binaryState = 11
        this.evaluate(rec)
    }
    /**
    * Removes file on a given path
    * @param {String} path File's path
    */
    removeFile(path) {
        const pCode = `from os import remove
remove('${path}')`
        this.execute(pCode)
    }

    _decodeResp(data) {
        if (data[0] == 'W'.charCodeAt(0) && data[1] == 'B'.charCodeAt(0)) {
            var code = data[2] | (data[3] << 8)
            return code;
        } else {
            return -1;
        }
    }
    _handleMessage(event) {
        if (event.data instanceof ArrayBuffer) {
            let data = new Uint8Array(event.data)
            switch (this.binaryState) {
                case 11:
                    // first response for put
                    if (this._decodeResp(data) == 0) {
                        // send file data in chunks
                        for (let offset = 0; offset < this.sendFileData.length; offset += 1024) {
                            this.ws.send(this.sendFileData.slice(offset, offset + 1024))
                        }
                        this.binaryState = 12
                    }
                    break
                case 12:
                    // final response for put
                    if (this._decodeResp(data) == 0) {
                        console.log(`Sent ${this.sendFileName}, ${this.sendFileData.length} bytes`)
                    } else {
                        console.log(`Failed sending ${this.sendFileName}`)
                    }
                    this.binaryState = 0
                    break;
                case 21:
                    // first response for get
                    if (this._decodeResp(data) == 0) {
                        this.binaryState = 22
                        var rec = new Uint8Array(1)
                        rec[0] = 0
                        this.ws.send(rec)
                    }
                    break;
                case 22: {
                    // file data
                    var sz = data[0] | (data[1] << 8)
                    if (data.length == 2 + sz) {
                        // we assume that the data comes in single chunks
                        if (sz == 0) {
                            // end of file
                            this.binaryState = 23
                        } else {
                            // accumulate incoming data to this.getFileData
                            var new_buf = new Uint8Array(this.getFileData.length + sz)
                            new_buf.set(this.getFileData)
                            new_buf.set(data.slice(2), this.getFileData.length)
                            this.getFileData = new_buf
                            console.log('Getting ' + this.getFileName + ', ' + this.getFileData.length + ' bytes')

                            var rec = new Uint8Array(1)
                            rec[0] = 0
                            this.ws.send(rec)
                        }
                    } else {
                        this.binaryState = 0
                    }
                    break;
                }
                case 23:
                    // final response
                    if (this._decodeResp(data) == 0) {
                        console.log(`Got ${this.getFileName}, ${this.getFileData.length} bytes`)
                        this._saveAs(this.getFileName, this.getFileData)
                    } else {
                        console.log(`Failed getting ${this.getFileName}`)
                    }
                    this.binaryState = 0
                    break
                case 31:
                    // first (and last) response for GET_VER
                    console.log('GET_VER', data)
                    this.binaryState = 0
                    break
            }
        }
        // If is asking for password, send password
        if( event.data == 'Password: ' ) {
            this.ws.send(`${this.password}\r`)
            this.emit('connected')
        }
        this.emit('output', event.data)
    }
    _Utf8ArrayToStr(array) {
        var out, i, len, c;
        var char2, char3;

        out = "";
        len = array.length;
        i = 0;
        while(i < len) {
        c = array[i++];
        switch(c >> 4)
        {
          case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
            out += String.fromCharCode(c);
            break;
          case 12: case 13:
            // 110x xxxx   10xx xxxx
            char2 = array[i++];
            out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            break;
          case 14:
            // 1110 xxxx  10xx xxxx  10xx xxxx
            char2 = array[i++];
            char3 = array[i++];
            out += String.fromCharCode(((c & 0x0F) << 12) |
                           ((char2 & 0x3F) << 6) |
                           ((char3 & 0x3F) << 0));
            break;
        }
        }

        return out;
    }
    _saveAs(fileName, data) {
        this.emit('output', this._Utf8ArrayToStr(data))
    }
    _enterRawRepl() {
        this.evaluate(this.ENTER_RAW_REPL)
    }
    _exitRawRepl() {
        this.evaluate(this.EXIT_RAW_REPL)
    }
    _executeRaw(raw) {
        this.evaluate(raw)
        if (raw.indexOf('\n') == -1) {
            this.evaluate('\r')
        }
    }

}

module.exports = WebsocketConnection
