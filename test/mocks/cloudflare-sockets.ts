const encoder = new TextEncoder()
const decoder = new TextDecoder()

function createResponseWriter(controller: ReadableStreamDefaultController<Uint8Array>) {
  return (response: string) => controller.enqueue(encoder.encode(response))
}

export function connect() {
  let writeResponse: (response: string) => void = () => undefined
  let closeReadable: () => void = () => undefined
  let authStep = 0
  let readingData = false

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      writeResponse = createResponseWriter(controller)
      closeReadable = () => controller.close()
      writeResponse('220 mock.smtp ESMTP\r\n')
    },
  })

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk)
      const command = text.trim()

      if (readingData) {
        if (text.includes('\r\n.\r\n') || command.endsWith('\n.')) {
          readingData = false
          writeResponse('250 2.0.0 mock-message-id\r\n')
        }
        return
      }

      if (command.startsWith('EHLO') || command.startsWith('HELO')) {
        writeResponse('250-mock.smtp\r\n250 AUTH LOGIN\r\n')
      }
      else if (command === 'AUTH LOGIN') {
        authStep = 1
        writeResponse('334 VXNlcm5hbWU6\r\n')
      }
      else if (authStep === 1) {
        authStep = 2
        writeResponse('334 UGFzc3dvcmQ6\r\n')
      }
      else if (authStep === 2) {
        authStep = 0
        writeResponse('235 2.7.0 Authentication successful\r\n')
      }
      else if (command.startsWith('MAIL FROM')) {
        writeResponse('250 2.1.0 OK\r\n')
      }
      else if (command.startsWith('RCPT TO')) {
        writeResponse('250 2.1.5 OK\r\n')
      }
      else if (command === 'DATA') {
        readingData = true
        writeResponse('354 End data with <CR><LF>.<CR><LF>\r\n')
      }
      else if (command === 'QUIT') {
        writeResponse('221 2.0.0 Bye\r\n')
        closeReadable()
      }
      else if (command === 'STARTTLS') {
        writeResponse('220 Ready to start TLS\r\n')
      }
      else {
        writeResponse('250 OK\r\n')
      }
    },
  })

  return {
    readable,
    writable,
    opened: Promise.resolve(),
    closed: Promise.resolve(),
    close: () => undefined,
    startTls: () => connect(),
  }
}
