# **factory.coffee**

# making factory.json cacheable.

fs = require 'fs'
path = require 'path'
events = require 'events'
writeFileAtomic = require 'write-file-atomic'
glob = require 'glob'
JSONStream = require 'JSONStream'

mkdirp = require 'mkdirp'

module.exports = exports = (argv) ->

  factories = []

  factoriesLoc = path.join(argv.status, 'factories.json')

  packageDir = argv.packageDir

  working = false

  factoriesSave = (factories, cb) ->
    fs.exists argv.status, (exists) ->
      if exists
        writeFileAtomic factoriesLoc, JSON.stringify(factories), (e) ->
          return cb(e) if e
          cb()
      else
        mkdirp argv.status, ->
          writeFileAtomic factoriesLoc, JSON.stringify(factories), (e) ->
            return cb(e) if e
            cb()


  #### Public stuff ####

  itself = new events.EventEmitter
  itself.start = ->
    working = true
    @emit 'working'
  itself.stop = ->
    factories = []
    working = false
    @emit 'finished'

  itself.isWorking = ->
    working

  itself.createFactories = ->

    console.log "in createFactories"

    itself.start()

    glob path.join(packageDir, 'wiki-plugin-*', 'factory.json'), (e, files) ->
      console.log "Error in factories glob: " + e if e
      files.map (file) ->
        entry = JSON.parse(fs.readFileSync(file))
        factories.push entry

      factoriesSave factories, (e) ->
        console.log "Error saving factories.json: " + e if e
        itself.stop()



  itself
