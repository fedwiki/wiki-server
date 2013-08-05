# **defaultargs.coffee** when called on the argv object this
# module will create reasonable defaults for options not supplied,
# based on what information is provided.
path = require 'path'

module.exports = (argv) ->
  argv or= {}
  argv.r or= __dirname
  argv.F or= 40000
  argv.p or= 3000
  argv.s or= 'welcome-visitors'
  argv.d or= path.join(argv.r, 'data')
  argv.c or= path.join(argv.r, 'client')
  argv.db or= path.join(argv.d, 'pages')
  argv.status or= path.join(argv.d, 'status')
  argv.u or= 'http://localhost' + (':' + argv.p) unless argv.p is 80
  argv.id or= path.join(argv.status, 'persona.identity')

  #resolve all relative paths
  argv.r = path.resolve(argv.r)
  argv.d = path.resolve(argv.d)
  argv.c = path.resolve(argv.c)
  argv.db = path.resolve(argv.db)
  argv.status = path.resolve(argv.status)
  argv.id = path.resolve(argv.id)

  argv
