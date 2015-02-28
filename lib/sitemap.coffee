###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-node-server/blob/master/LICENSE.txt
###

# **sitemap.coffee**

fs = require 'fs'
path = require 'path'
events = require 'events'
writeFileAtomic = require 'write-file-atomic'

mkdirp = require 'mkdirp'

synopsis = require 'wiki-client/lib/synopsis'

module.exports = exports = (argv) ->

  sitemap = []

  queue = []

  sitemapPageHandler = null

  # ms since last update we will remove sitemap from memory
  sitemapTimeoutMs = 1200000
  sitemapTimeoutHandler = null

  sitemapLoc = path.join(argv.status, 'sitemap.json')

  working = false

  lastEdit = (journal) ->
    for action in (journal || []) by -1
      return action.date if action.date and action.type != 'fork'
    undefined

  sitemapUpdate = (file, page, cb) ->

    entry = {
      'slug': file
      'title': page.title
      'date': lastEdit(page.journal)
      'synopsis': synopsis(page)
    }

    slugs = sitemap.map (page) -> page.slug

    idx = slugs.indexOf(file)

    if ~idx
      sitemap[idx] = entry
    else
      sitemap.push entry

    cb()

  sitemapSave = (sitemap, cb) ->
    fs.exists argv.status, (exists) ->
      if exists
        writeFileAtomic sitemapLoc, JSON.stringify(sitemap), (e) ->
          return cb(e) if e
          cb()
      else
        mkdirp argv.status, ->
          writeFileAtomic sitemapLoc, JSON.stringify(sitemap), (e) ->
            return cb(e) if e
            cb()

  sitemapRestore = (cb) ->
    fs.exists sitemapLoc, (exists) ->
      if exists
        fs.readFile(sitemapLoc, (err, data) ->
          return cb(err) if err
          try
            sitemap = JSON.parse(data)
          catch e
            return cb(e)
          process.nextTick( ->
            serial(queue.shift()))
        )
      else
        # sitemap file does not exist, so needs creating
        itself.createSitemap(sitemapPageHandler)


  serial = (item) ->
    if item
      itself.start()
      sitemapUpdate(item.file, item.page, (e) ->
        process.nextTick( ->
          serial(queue.shift())
        )
      )
    else
      sitemapSave sitemap, (e) ->
        console.log "Problems saving sitemap: "+ e if e
        itself.stop()


  #### Public stuff ####

  itself = new events.EventEmitter
  itself.start = ->
    clearTimeout(sitemapTimeoutHandler)
    working = true
    @emit 'working'
  itself.stop = ->
    clearsitemap = ->
      console.log "removing sitemap from memory"
      sitemap = []
    sitemapTimeoutHandler = setTimeout clearsitemap, sitemapTimeoutMs
    working = false
    @emit 'finished'

  itself.isWorking = ->
    working

  itself.createSitemap = (pagehandler) ->

    itself.start()

    # we save the pagehandler, so we can recreate the sitemap if it is removed
    sitemapPageHandler = pagehandler if !sitemapPageHandler?

    pagehandler.pages (e, newsitemap) ->
      if e
        console.log "createSitemap: error " + e
        itself.stop()
        return e
      sitemap = newsitemap

      process.nextTick ( ->
        serial(queue.shift()))

  itself.update = (file, page) ->
    queue.push({file, page})
    if sitemap = [] and !working
      itself.start()
      sitemapRestore (e) ->
        console.log "Problems restoring sitemap: " + e if e
        itself.createSitemap(sitemapPageHandler)
    else
      serial(queue.shift()) unless working



  itself
