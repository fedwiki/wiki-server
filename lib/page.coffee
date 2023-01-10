###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###
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

asSlug = (name) ->
  name.replace(/\s/g, '-').replace(/[^A-Za-z0-9-]/g, '').toLowerCase()


# Export a function that generates a page handler
# when called with options object.
module.exports = exports = (argv) ->

  wikiName = new URL(argv.url).hostname

  mkdirp argv.db, (e) ->
    if e then throw e

  #### Private utility methods. ####
  load_parse = (loc, cb, annotations={}) ->
    fs.readFile(loc, (err, data) ->
      return cb(err) if err
      try
        page = JSON.parse(data)
      catch e
        errorPage = path.basename(loc)
        errorPagePath = path.dirname(loc)
        recyclePage = path.resolve(errorPagePath, '..', 'recycle', errorPage)
        fs.exists(path.dirname(recyclePage), (exists) ->
          if exists
            fs.rename(loc, recyclePage, (err) ->
              if err
                console.log "ERROR: moving problem page #{loc} to recycler", err
              else
                console.log "ERROR: problem page #{loc} moved to recycler"
              )
          else
            mkdirp(path.dirname(recyclePage), (err) ->
              if err
                console.log "ERROR: creating recycler", err
              else
                fs.rename(loc, recyclePage, (err) ->
                  if err
                    console.log "ERROR: moving problem page #{loc} to recycler", err
                  else
                    console.log "ERROR: problem page #{loc} moved to recycler"
                  )
              )
            )
        return cb(null, 'Error Parsing Page', 404)
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
  fileio = (action, file, page, cb) ->
    if file.startsWith 'recycler/'
      loc = path.join(argv.recycler, file.split('/')[1])
    else
      loc = path.join(argv.db, file)
    switch action
      when 'delete'
        if file.startsWith 'recycler/'
          # delete from recycler
          fs.exists(loc, (exists) ->
            if exists
              fs.unlink(loc, (err) ->
                cb(err)
              )
          )
        else
          # move page to recycler
          fs.exists(loc, (exists) ->
            if exists
              recycleLoc = path.join(argv.recycler, file)
              fs.exists(path.dirname(recycleLoc), (exists) ->
                if exists
                  fs.rename(loc, recycleLoc, (err) ->
                    cb(err)
                  )
                else
                  mkdirp(path.dirname(recycleLoc), (err) ->
                    if err then cb(err)
                    fs.rename(loc, recycleLoc, (err) ->
                      cb(err)
                    )
                  )
              )
            else
              cb('page does not exist')
          )
      when 'recycle'
        copyFile = (source, target, cb) ->

          done = (err) ->
            if !cbCalled
              cb err
              cbCalled = true
            return

          cbCalled = false

          rd = fs.createReadStream(source)
          rd.on 'error', (err) ->
            done err
            return

          wr = fs.createWriteStream(target)
          wr.on 'error', (err) ->
            done err
            return
          wr.on 'close', (ex) ->
            done()
            return
          rd.pipe wr
          return

        fs.exists(loc, (exists) ->
          if exists
            recycleLoc = path.join(argv.recycler, file)
            fs.exists(path.dirname(recycleLoc), (exists) ->
              if exists
                copyFile(loc, recycleLoc, (err) ->
                  cb(err)
                )
              else
                mkdirp(path.dirname(recycleLoc), (err) ->
                  if err then cb(err)
                  copyFile(loc, recycleLoc, (err) ->
                    cb(err)
                  )
                )
            )
          else
            cb('page does not exist')
        )
      when 'get'
        fs.exists(loc, (exists) ->
          if exists
            load_parse(loc, cb, {plugin: undefined})
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
      when 'put'
        page = JSON.stringify(page, null, 2)
        fs.exists(path.dirname(loc), (exists) ->
          if exists
            fs.writeFile(loc, page, (err) ->
              if err
                console.log "ERROR: write file #{loc} ", err
              cb(err)
            )
          else
            mkdirp(path.dirname(loc), (err) ->
              if err then cb(err)
              fs.writeFile(loc, page, (err) ->
                if err
                  console.log "ERROR: write file #{loc} ", err 
                cb(err)
              )
            )
        )
      else
        console.log "pagehandler: unrecognized action #{action}"

  # Control variable that tells if the serial queue is currently working.
  # Set back to false when all jobs are complete.
  working = false

  # Keep file io working on queued jobs, but don't block the main thread.
  serial = (item) ->
    if item
      itself.start()
      fileio(item.action, item.file, item.page, (err, data, status) ->
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
    queue.push({action: 'get', file, page: null, cb})
    serial(queue.shift()) unless working

  # put takes a slugged name, the page as a json object, and a callback.
  # adds them to the queue, and starts it unless it is working.
  itself.put =  (file, page, cb) ->
    queue.push({action: 'put', file, page, cb})
    serial(queue.shift()) unless working

  itself.delete = (file, cb) ->
    queue.push({action: 'delete', file, page: null, cb})
    serial(queue.shift()) unless working

  itself.saveToRecycler = (file, cb) ->
    queue.push({action: 'recycle', file, page: null, cb})
    serial(queue.shift()) unless working

  editDate = (journal) ->
    for action in (journal || []) by -1
      return action.date if action.date and action.type != 'fork'
    undefined

  itself.pages = (cb) ->

    extractPageLinks = (collaborativeLinks, currentItem, currentIndex, array) ->
      # extract collaborative links 
      # - this will need extending if we also extract the id of the item containing the link
      try
        linkRe = /\[\[([^\]]+)\]\]/g
        match = undefined
        while (match = linkRe.exec(currentItem.text)) != null
          if not collaborativeLinks.has(asSlug(match[1]))
            collaborativeLinks.set(asSlug(match[1]), currentItem.id)
        if 'reference' == currentItem.type
          if not collaborativeLinks.has(currentItem.slug)
            collaborativeLinks.set(currentItem.slug, currentItem.id)
      catch err
        console.log "METADATA *** #{wikiName} Error extracting links from #{currentIndex} of #{JSON.stringify(array)}", err.message
      collaborativeLinks

    fs.readdir argv.db, (e, files) ->
      return cb(e) if e
      # used to make sure all of the files are read
      # and processesed in the site map before responding
      doSitemap = (file, cb) ->
        itself.get file, (e, page, status) ->
          return cb() if file.match /^\./
          if e or status is 404
            console.log 'Problem building sitemap:', file, 'e: ', e, 'status:', status
            return cb() # Ignore errors in the pagehandler get.

          try
            pageLinksMap = page.story.reduce( extractPageLinks, new Map())
          catch err
            console.log "METADATA *** #{wikiName} reduce to extract links on #{file} failed", err.message
            pageLinksMap = []
          #
          if pageLinksMap.size > 0
            pageLinks = Object.fromEntries(pageLinksMap)
          else
            pageLinks = undefined
        
          cb null, {
            slug     : file
            title    : page.title
            date     : editDate(page.journal)
            synopsis : synopsis(page)
            links    : pageLinks
          }

      async.map files, doSitemap, (e, sitemap) ->
        return cb(e) if e
        cb null, sitemap.filter (item) -> if item? then true

  itself.slugs = (cb) ->
    fs.readdir argv.db, (e, files) ->
      if e
        console.log 'Problem reading pages directory', e
        cb(e)
      else
        cb(null, files)

  itself
