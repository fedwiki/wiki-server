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
    working = true
    @emit 'working'
  itself.stop = ->
    working = false
    @emit 'finished'

  itself.isWorking = ->
    working

  itself.createSitemap = (pagehandler) ->

    itself.start()

    pagehandler.pages (e, newsitemap) ->
      if e
        console.log "createSitemap: error " + e
        return e
      sitemap = newsitemap

      process.nextTick ( ->
        serial(queue.shift()))

  itself.update = (file, page) ->
    queue.push({file, page})
    serial(queue.shift()) unless working



  itself
