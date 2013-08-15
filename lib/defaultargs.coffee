# **defaultargs.coffee** when called on the argv object this
# module will create reasonable defaults for options not supplied,
# based on what information is provided.
path = require 'path'

module.exports = (argv) ->
  argv or= {}
  argv.root or= __dirname
  argv.farmPort or= 40000
  argv.port or= 3000
  argv.home or= 'welcome-visitors'
  argv.data or= path.join(argv.root, 'data')
  argv.client or= path.join(argv.root, 'client')
  argv.db or= path.join(argv.data, 'pages')
  argv.status or= path.join(argv.data, 'status')
  argv.url or= 'http://localhost' + (':' + argv.port) unless argv.port is 80
  argv.id or= path.join(argv.status, 'persona.identity')

  if typeof(argv.database) is 'string'
    argv.database = JSON.parse(argv.database)
  argv.database or= {}
  argv.database.type or= './page'

  #resolve all relative paths
  argv.root = path.resolve(argv.root)
  argv.data = path.resolve(argv.data)
  argv.client = path.resolve(argv.client)
  argv.db = path.resolve(argv.db)
  argv.status = path.resolve(argv.status)
  argv.id = path.resolve(argv.id)

  argv
