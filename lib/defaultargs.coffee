###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###


# **defaultargs.coffee** when called on the argv object this
# module will create reasonable defaults for options not supplied,
# based on what information is provided.
path = require 'path'

getUserHome = ->
  process.env.HOME or process.env.HOMEPATH or process.env.USERPROFILE

module.exports = (argv) ->
  argv or= {}
  argv.root or= __dirname
  # the directory that contains all the packages that makeup the wiki
  argv.packageDir or= path.join(argv.root, "..")
  argv.port or= 3000
  argv.home or= 'welcome-visitors'
  argv.data or= path.join(getUserHome(), '.wiki') # see also cli
  argv.client or= path.join(argv.packageDir, 'wiki-client', 'client')
  argv.db or= path.join(argv.data, 'pages')
  argv.status or= path.join(argv.data, 'status')
  argv.assets or= path.join(argv.data, 'assets')
  argv.recycler or= path.join(argv.data, 'recycle')
  argv.commons or= path.join(argv.data, 'commons')
  argv.url or= 'http://localhost' + (if argv.port is 80 then '' else ':' + argv.port)
  argv.id or= path.join(argv.status, 'owner.json')
  argv.uploadLimit or= '5mb'
  argv.cookieSecret or= require('crypto').randomBytes(64).toString('hex')
  argv.secure_cookie or= false
  argv.session_duration or= 7
  argv.neighbors or= ''
  argv.debug or= false

  if typeof(argv.database) is 'string'
    argv.database = JSON.parse(argv.database)
  argv.database or= {}
  argv.database.type or= './page'
  if argv.database.type.charAt(0) is '.'
    if argv.database.type != './page'
      console.log "\n\nWARNING: This storage option is depeciated."
      console.log "    See ReadMe for details of the changes required.\n\n"
  else
    argv.database.type = 'wiki-storage-' + argv.database.type

  argv.security_type or= './security'
  if argv.security_type is './security'
    console.log "\n\nINFORMATION: Using default security module."
  else
    argv.security_type = 'wiki-security-' + argv.security_type
  argv.security_legacy or= false

  #resolve all relative paths
  argv.root = path.resolve(argv.root)
  argv.packageDir = path.resolve(argv.packageDir)
  argv.data = path.resolve(argv.data)
  argv.client = path.resolve(argv.client)
  argv.db = path.resolve(argv.db)
  argv.status = path.resolve(argv.status)
  argv.assets = path.resolve(argv.assets)
  argv.recycler = path.resolve(argv.recycler)
  argv.commons = path.resolve(argv.commons)
  argv.id = path.resolve(argv.id)

  if /node_modules/.test(argv.data)
    console.log "\n\nWARNING : The dafault data path is not a safe place."
    console.log "       : by using ", argv.data, " your pages will be lost when packages are updated."
    console.log "       : You are strongly advised to use an alternative directory."
    console.log "       : See the wiki package ReadMe for how to do this.\n\n"

  argv
