const init = (app, emitter) => {
  let sockets = []
  app.io.on('connection', (socket) => {
    let listeners = []
    sockets.push(socket)
    console.log('connected')
    socket.on('disconnect', () => {
      for (let {sProducer, listener} of listeners) {
        console.log('deregistering', sProducer)
        // TODO: Shouldn't the listener list be cleared here?
        emitter.removeListener(sProducer, listener)
      }
      console.log('size before:', sockets.length)
      let i = sockets.indexOf(socket)
      sockets.splice(i, 1)
      console.log('size after:', sockets.length)
    })
    socket.on('unsubscribe', (sProducer) => {
      console.log('unsubscribing listener for', sProducer)
      for (let [i, {slugItem, listener}] of listeners.entries()) {
        if (slugItem == sProducer) {
          console.log('found listener to remove for', sProducer)
          emitter.removeListener(sProducer, listener)
          listeners.splice(i, 1)
        }
      }
    })
    socket.on('subscribe', (sProducer) => {
      let listener = (result) => {
        console.log('forwarding to client', result)
        socket.emit(sProducer, {slugItem: sProducer, result})
      }
      console.log(`registering ${sProducer} as listener`)
      emitter.on(sProducer, listener)
      listeners.push({sProducer, listener})
    })
  })
}
module.exports = {init}
