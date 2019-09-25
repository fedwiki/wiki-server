const init = (app, emitter) => {
  let sockets = []
  app.io.on('connection', (socket) => {
    let listeners = []
    sockets.push(socket)
    console.log('client connected:', socket.handshake.address)
    socket.on('disconnect', (reason) => {
      console.log('client disconnected:', socket.handshake.address, reason)
      for (let {sProducer, listener} of listeners) {
        console.log('deregistering listener:', sProducer)
        emitter.removeListener(sProducer, listener)
      }
      listeners = []
      let i = sockets.indexOf(socket)
      sockets.splice(i, 1)
    })
    socket.on('unsubscribe', (sProducer) => {
      console.log('unsubscribing listener:', sProducer)
      for (let [i, {slugItem, listener}] of listeners.entries()) {
        if (slugItem == sProducer) {
          console.log('found listener to remove:', sProducer)
          emitter.removeListener(sProducer, listener)
          listeners.splice(i, 1)
        }
      }
    })
    socket.on('subscribe', (sProducer) => {
      let listener = (result) => {
        console.log('forwarding to client:', result)
        socket.emit(sProducer, {slugItem: sProducer, result})
      }
      console.log(`registering as listener:`, sProducer)
      emitter.on(sProducer, listener)
      listeners.push({sProducer, listener})
    })
  })
}
module.exports = {init}
