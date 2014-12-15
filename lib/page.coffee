# **page.coffee**
# Module for interacting with pages persisted on the server.
# Everything is stored using json flat files.

#### Requires ####
fs = require 'fs'
path = require 'path'
events = require 'events'
glob = require 'glob'

mkdirp = require 'mkdirp'
async = require 'async'

random_id = require './random_id'
synopsis = require 'wiki-client/lib/synopsis'

# Export a function that generates a page handler
# when called with options object.
module.exports = exports = (argv) ->
  mkdirp argv.db, (e) ->
    if e then throw e

  #### Private utility methods. ####
  load_parse = (loc, cb, annotations={}) ->
    fs.readFile(loc, (err, data) ->
      return cb(err) if err
      try
        page = JSON.parse(data)
      catch e
        return cb(e)
      for key, val of annotations
        page[key] = val
      cb(null, page)
    )

  load_parse_copy = (defloc, file, cb) ->
    fs.readFile(defloc, (err, data) ->
      if err then cb(err)
      try
        page = JSON.parse(data)
      catch e
        return cb(e)
      cb(null, page)
      itself.put(file, page, (err) ->
        if err then cb(err)
      )
    )

  # Reads and writes are async, but serially queued to avoid race conditions.
  queue = []

  # Main file io function, when called without page it reads,
  # when called with page it writes.
  fileio = (file, page, cb) ->
    loc = path.join(argv.db, file)
    unless page?
      fs.exists(loc, (exists) =>
        if exists
          load_parse(loc, cb)
        else
          defloc = path.join(argv.root, 'default-data', 'pages', file)
          fs.exists(defloc, (exists) ->
            if exists
              load_parse(defloc, cb)
            else

              glob "wiki-plugin-*/pages", {cwd: argv.packageDir}, (e, plugins) ->
                if e then return cb(e)

                # if no plugins found
                if plugins.length is 0
                  cb(null, 'Page not found', 404)

                giveUp = do ->
                  count = plugins.length
                  return ->
                    count -= 1
                    if count is 0
                      cb(null, 'Page not found', 404)

                for plugin in plugins
                  do ->
                    pluginName = plugin.slice(12, -6)
                    pluginloc = path.join(argv.packageDir, plugin, file)
                    fs.exists(pluginloc, (exists) ->
                      if exists
                        load_parse(pluginloc, cb, {plugin: pluginName})
                      else
                        giveUp()
                    )
          )
      )
    else
      page = JSON.stringify(page, null, 2)
      fs.exists(path.dirname(loc), (exists) ->
        if exists
          fs.writeFile(loc, page, (err) ->
            cb(err)
          )
        else
          mkdirp(path.dirname(loc), (err) ->
            if err then cb(err)
            fs.writeFile(loc, page, (err) ->
              cb(err)
            )
          )
      )

  # Control variable that tells if the serial queue is currently working.
  # Set back to false when all jobs are complete.
  working = false

  # Keep file io working on queued jobs, but don't block the main thread.
  serial = (item) ->
    if item
      itself.start()
      fileio(item.file, item.page, (err, data, status) ->
        process.nextTick( ->
          serial(queue.shift())
        )
        item.cb(err, data, status)
      )
    else
      itself.stop()

  #### Public stuff ####
  # Make the exported object an instance of EventEmitter
  # so other modules can tell if it is working or not.
  itself = new events.EventEmitter
  itself.start = ->
    working = true
    @emit 'working'
  itself.stop = ->
    working = false
    @emit 'finished'

  itself.isWorking = ->
    working

  # get method takes a slug and a callback, adding them to the queue,
  # starting serial if it isn't already working.
  itself.get = (file, cb) ->
    queue.push({file, page: null, cb})
    serial(queue.shift()) unless working

  # put takes a slugged name, the page as a json object, and a callback.
  # adds them to the queue, and starts it unless it is working.
  itself.put =  (file, page, cb) ->
      queue.push({file, page, cb})
      serial(queue.shift()) unless working

  editDate = (journal) ->
    for action in (journal || []) by -1
      return action.date if action.date and action.type != 'fork'
    undefined

  itself.pages = (cb) ->
    fs.readdir argv.db, (e, files) ->
      return cb(e) if e
      # used to make sure all of the files are read
      # and processesed in the site map before responding
      doSitemap = (file, cb) ->
        itself.get file, (e, page, status) ->
          return cb() if file.match /^\./
          if e
            console.log 'Problem building sitemap:', file, 'e: ', e
            return cb() # Ignore errors in the pagehandler get.
          cb null, {
            slug     : file
            title    : page.title
            date     : editDate(page.journal)
            synopsis : synopsis(page)
          }

      async.map files, doSitemap, (e, sitemap) ->
        return cb(e) if e
        cb null, sitemap.filter (item) -> if item? then true

  itself
