# **defaultargs.coffee** when called on the argv object this
# module will create reasonable defaults for options not supplied,
# based on what information is provided.
path = require 'path'

module.exports = (argv) ->
  argv or= {}
# NOTE: root is wiki-server's root, so something like ...wiki/node_modules/wiki-server
#       it might make sense to use something else, we can find everything relative to
#       root.
  argv.root or= __dirname
# the directory that contains all the packages that go to makeup the wiki
  argv.packageDir or= path.join(argv.root, '..')
  argv.farmPort or= 40000
  argv.port or= 3000
  argv.home or= 'welcome-visitors'
  argv.data or= path.join(argv.root, '..', '..', 'data')
  argv.client or= path.join(argv.packageDir, 'wiki-client', 'client')
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
  argv.packageDir = path.resolve(argv.packageDir)
  argv.data = path.resolve(argv.data)
  argv.client = path.resolve(argv.client)
  argv.db = path.resolve(argv.db)
  argv.status = path.resolve(argv.status)
  argv.id = path.resolve(argv.id)

  if /node_modules/.test(argv.data)
    console.log "\n\nWARNING : The dafault data path is not a safe place."
    console.log "       : by using ", argv.data, " your pages will be lost when packages are updated."
    console.log "       : You are strongly advised to use an alternative directory."
    console.log "       : See the wiki package ReadMe for how to do this.\n\n"

  argv
