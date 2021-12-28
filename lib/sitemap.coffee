###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###

# **sitemap.coffee**

fs = require 'fs'
path = require 'path'
events = require 'events'
writeFileAtomic = require 'write-file-atomic'
_ = require 'lodash'
xml2js = require 'xml2js'

mkdirp = require 'mkdirp'

synopsis = require 'wiki-client/lib/synopsis'

asSlug = (name) ->
  name.replace(/\s/g, '-').replace(/[^A-Za-z0-9-]/g, '').toLowerCase()


module.exports = exports = (argv) ->

  wikiName = new URL(argv.url).hostname

  sitemap = []

  queue = []

  sitemapPageHandler = null

  # ms since last update we will remove sitemap from memory
  sitemapTimeoutMs = 120000
  sitemapTimeoutHandler = null

  sitemapLoc = path.join(argv.status, 'sitemap.json')
  xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')

  working = false

  lastEdit = (journal) ->
    for action in (journal || []) by -1
      return action.date if action.date and action.type != 'fork'
    undefined

  sitemapUpdate = (file, page, cb) ->

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

    entry = {
      'slug': file
      'title': page.title
      'date': lastEdit(page.journal)
      'synopsis': synopsis(page)
      'links': pageLinks
    }

    slugs = sitemap.map (page) -> page.slug

    idx = slugs.indexOf(file)

    if ~idx
      sitemap[idx] = entry
    else
      sitemap.push entry

    cb()

  sitemapRemovePage = (file, cb) ->
    slugs = sitemap.map (page) -> page.slug
    idx = slugs.indexOf(file)

    if ~idx
      _.pullAt(sitemap, idx)

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

  xmlSitemapSave = (sitemap, cb) ->
    xmlmap = []
    _.each sitemap, (page) ->
      result = {}
      result["loc"] = argv.url + "/" + page.slug + ".html"
      if page.date?
        date = new Date(page.date)
        if !(isNaN(date.valueOf()))
          result["lastmod"] = date.toISOString().substring(0,10)
      xmlmap.push result
    xmlmap = {'urlset': {"$": {"xmlns": "http://www.sitemaps.org/schemas/sitemap/0.9"},'url': xmlmap}}
    builder = new xml2js.Builder()
    xml = builder.buildObject(xmlmap)
    fs.exists argv.status, (exists) ->
      if exists
        writeFileAtomic xmlSitemapLoc, xml, (e) ->
          return cb(e) if e
          cb()
      else
        mkdirp argv.status, ->
          writeFileAtomic xmlSitemapLoc, xml, (e) ->
            return cb(e) if e
            cb()

  serial = (item) ->
    if item
      switch item.action
        when "update"
          itself.start()
          sitemapUpdate(item.file, item.page, (e) ->
            process.nextTick( ->
              serial(queue.shift())
            )
          )
        when "remove"
          itself.start()
          sitemapRemovePage(item.file, (e) ->
            process.nextTick( ->
              serial(queue.shift())
            )
          )
        else
          console.log "Sitemap unexpected action #{item.action} for #{item.page} in #{wikiName}"
          process.nextTick( ->
            serial(queue.shift))
    else
      sitemapSave sitemap, (e) ->
        console.log "Problems saving sitemap #{wikiName}: "+ e if e
        itself.stop()
      xmlSitemapSave sitemap, (e) ->
        console.log "Problems saving sitemap(xml) #{wikiName}"+ e if e


  #### Public stuff ####

  itself = new events.EventEmitter
  itself.start = ->
    clearTimeout(sitemapTimeoutHandler)
    working = true
    @emit 'working'
  itself.stop = ->
    clearsitemap = ->
      console.log "removing sitemap #{wikiName} from memory"
      sitemap = []
      clearTimeout(sitemapTimeoutHandler)
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
        console.log "createSitemap #{wikiName} : error " + e
        itself.stop()
        return e
      sitemap = newsitemap

      process.nextTick ( ->
        serial(queue.shift()))

  itself.removePage = (file) ->
    action = "remove"
    queue.push({action, file, ""})
    if sitemap.length is 0 and !working
      itself.start()
      sitemapRestore (e) ->
        console.log "Problems restoring sitemap #{wikiName} : " + e if e
        itself.createSitemap(sitemapPageHandler)
    else
      serial(queue.shift()) unless working


  itself.update = (file, page) ->
    action = "update"
    queue.push({action, file, page})
    if sitemap.length is 0 and !working
      itself.start()
      sitemapRestore (e) ->
        console.log "Problems restoring sitemap #{wikiName} : " + e if e
        itself.createSitemap(sitemapPageHandler)
    else
      serial(queue.shift()) unless working



  itself
