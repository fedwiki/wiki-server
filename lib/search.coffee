###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###

# **search.coffee**

fs = require 'fs'
path = require 'path'
events = require 'events'
url = require 'node:url'
writeFileAtomic = require 'write-file-atomic'

miniSearch = require 'minisearch'

module.exports = exports = (argv) ->
  
  wikiName = new URL(argv.url).hostname

  siteIndex = []

  queue = []

  searchPageHandler = null

  # ms since last update we will remove index from memory
  # orig - searchTimeoutMs = 1200000
  searchTimeoutMs = 120000     # temp reduce to 2 minutes
  searchTimeoutHandler = null

  siteIndexLoc = path.join(argv.status, 'site-index.json')
  indexUpdateFlag = path.join(argv.status, 'index-updated')

  working = false

  touch = (file, cb) ->
    fs.stat file, (err, stats) ->
      return cb() if err is null
      fs.open file, 'w', (err,fd) ->
        cb(err) if err
        fs.close fd, (err) ->
          cb(err)

  searchPageUpdate = (slug, page, cb) ->
    # to update we have to remove the page first, and then readd it
    try
      pageText = page.story.reduce( extractPageText, '')
    catch err
      console.log "SITE INDEX *** #{wikiName} reduce to extract the text on #{slug} failed", err.message
      pageText = ""
    if siteIndex.has slug
      siteIndex.replace {
        'id': slug
        'title': page.title
        'content': pageText
      }
    else
      siteIndex.add {
        'id': slug
        'title': page.title
        'content': pageText
      }
    cb()

  searchPageRemove = (slug, cb) ->
    # remove page from index
    timeLabel = "SITE INDEX page remove #{slug} - #{wikiName}"
    try
      siteIndex.discard slug 
    catch err
      # swallow error, if the page was not in index
      console.log "removing #{slug} from index #{wikiName} failed", err unless err.message.includes('not in the index')
    cb()

  searchSave = (siteIndex, cb) ->
    # save index to file
    fs.exists argv.status, (exists) ->
      if exists
        writeFileAtomic siteIndexLoc, JSON.stringify(siteIndex), (e) ->
          return cb(e) if e
          touch indexUpdateFlag, (err) ->
            cb()
      else
        fs.mkdir argv.status, { recursive: true }, ->
          writeFileAtomic siteIndexLoc, JSON.stringify(siteIndex), (e) ->
            return cb(e) if e
            touch indexUpdateFlag, (err) ->
              cb()


  searchRestore = (cb) ->
    # restore index, or create if it doesn't already exist
    fs.exists siteIndexLoc, (exists) ->
      if exists
        fs.readFile(siteIndexLoc, (err, data) ->
          return cb(err) if err
          try
            siteIndex = miniSearch.loadJSON data,
              fields: ['title', 'content']
          catch e
            return cb(e)
          process.nextTick( ->
            serial(queue.shift())))

  serial = (item) ->
    if item
      switch item.action
        when "update"
          itself.start()
          searchPageUpdate(item.slug, item.page, (e) ->
            process.nextTick( ->
              serial(queue.shift())
            )
          )
        when "remove"
          itself.start()
          searchPageRemove(item.slug, (e) ->
            process.nextTick( ->
              serial(queue.shift())
            )
          )
        else
          console.log "SITE INDEX *** unexpected action #{item.action} for #{item.page}"
          process.nextTick( ->
            serial(queue.shift))
    else
      searchSave siteIndex, (e) ->
        console.log "SITE INDEX *** save failed: " + e if e
        itself.stop()

  extractItemText = (text) ->
    return text.replace(/\[([^\]]*?)\][\[\(].*?[\]\)]/g, " $1 ")
      .replace(/\[{2}|\[(?:[\S]+)|\]{1,2}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/<style.*?<\/style>/g, ' ')
      .replace(/<(?:"[^"]*"['"]*|'[^']*'['"]*|[^'">])+>/g, ' ')
      .replace(/<(?:[^>])+>/g, ' ')
      .replace(/(https?.*?)(?=\p{White_Space}|\p{Quotation_Mark}|$)/gu, (match) ->
        myUrl = url.parse(match)
        return myUrl.hostname + myUrl.pathname)
      .replace(/[\p{P}\p{Emoji}\p{Symbol}}]+/gu, ' ')
      .replace /[\p{White_Space}\n\t]+/gu, ' '


  extractPageText = (pageText, currentItem, currentIndex, array) ->
    # console.log('extractPageText', pageText, currentItem, currentIndex, array)
    try
      if currentItem.text?
        switch currentItem.type
          when 'paragraph', 'markdown', 'html', 'reference', 'image', 'pagefold', 'math', 'mathjax', 'code'
            pageText += ' ' + extractItemText currentItem.text
          when 'audio', 'video', 'frame'
            pageText += ' ' + extractItemText(currentItem.text.split(/\r\n?|\n/)
              .map((line) ->
                firstWord = line.split(/\p{White_Space}/u)[0]
                if firstWord.startsWith('http') or firstWord.toUpperCase() is firstWord or firstWord.startsWith('//')
                  # line is markup
                  return ''
                else
                  return line
              ).join(' '))
    catch err
      throw new Error("Error extracting text from #{currentIndex}, #{JSON.stringify(currentItem)} #{err}, #{err.stack}")
    pageText


  #### Public stuff ####

  itself = new events.EventEmitter
  itself.start = ->
    clearTimeout(searchTimeoutHandler)
    working = true
    @emit 'indexing'
  itself.stop = ->
    clearsearch = ->
      console.log "SITE INDEX #{wikiName} : removed from memory"
      siteIndex = []
      clearTimeout(searchTimeoutHandler)
    searchTimeoutHandler = setTimeout clearsearch, searchTimeoutMs
    working = false
    @emit 'indexed'

  itself.isWorking = ->
    working

  itself.createIndex = (pagehandler) ->

    itself.start()

    # we save the pagehandler, so we can recreate the site index if it is removed
    searchPageHandler = pagehandler if !searchPageHandler?

    #timeLabel = "SITE INDEX #{wikiName} : Created"
    #console.time timeLabel

    pagehandler.slugs (e, slugs) ->
      if e
        console.log "SITE INDEX *** createIndex #{wikiName} error:", e
        itself.stop()
        return e
      
      siteIndex = new miniSearch({
        fields: ['title', 'content']
      })

      indexPromises = slugs.map (slug) ->
        return new Promise (resolve) ->
          pagehandler.get slug, (err, page) ->
            if err
              console.log "SITE INDEX *** #{wikiName}: error reading page", slug
              return
            # page
            try
              pageText = page.story.reduce( extractPageText, '')
            catch err
              console.log "SITE INDEX *** #{wikiName} reduce to extract text on #{slug} failed", err.message
              # console.log "page", page
              pageText = ""
            siteIndex.add {
              'id': slug
              'title': page.title
              'content': pageText
            }
            resolve()
  
      Promise.all(indexPromises)
      .then () ->
        # console.timeEnd timeLabel
        process.nextTick ( ->
          serial(queue.shift()))
      
  itself.removePage = (slug) ->
    action = "remove"
    queue.push({action, slug })
    if Array.isArray(siteIndex) and !working
      itself.start()
      searchRestore (e) ->
        console.log "SITE INDEX *** Problems restoring search index #{wikiName}:" + e if e
        itself.createIndex(searchPageHandler)
    else
      serial(queue.shift()) unless working

  itself.update = (slug, page) ->
    action = "update"
    queue.push({action, slug, page})
    if Array.isArray(siteIndex) and !working
      itself.start()
      searchRestore( (e) ->
        console.log "SITE INDEX *** Problems restoring search index #{wikiName}:" + e if e
        itself.createIndex(searchPageHandler))
    else
      serial(queue.shift()) unless working

  itself.startUp = (pagehandler) ->
    # called on server startup, here we check if wiki already is index
    # we only create an index if there is either no index or there have been updates since last startup
    console.log "SITE INDEX #{wikiName} : StartUp"
    fs.stat siteIndexLoc, (err, stats) ->
      if err is null
        # site index exists, but has it been updated?
        fs.stat indexUpdateFlag, (err, stats) ->
          if !err
            # index has been updated, so recreate it. 
            itself.createIndex pagehandler
            # remove the update flag once the index has been created
            itself.once 'indexed', ->
              fs.unlink indexUpdateFlag, (err) ->
                console.log "+++ SITE INDEX #{wikiName} : unable to delete update flag" if err
          else
            # not been updated, but is it the correct version?
            fs.readFile siteIndexLoc, (err, data) ->
              if !err
                try
                  testIndex = JSON.parse(data)
                catch err
                  testIndex = {}
                if testIndex.serializationVersion != 2
                  console.log "+++ SITE INDEX #{wikiName} : updating to latest version."
                  itself.createIndex pagehandler
                  # remove the update flag once the index has been created
                  itself.once 'indexed', ->
                    fs.unlink indexUpdateFlag, (err) ->
                      console.log "+++ SITE INDEX #{wikiName} : unable to delete update flag" if err
              else
                console.log "+++ SITE INDEX #{wikiName} : error reading index - attempting creating"
                itself.createIndex pagehandler
                # remove the update flag once the index has been created
                itself.once 'indexed', ->
                  fs.unlink indexUpdateFlag, (err) ->
                    console.log "+++ SITE INDEX #{wikiName} : unable to delete update flag" if err
      else
        # index does not exist, so create it
        itself.createIndex pagehandler
        # remove the update flag once the index has been created
        itself.once 'indexed', ->
          fs.unlink indexUpdateFlag, (err) ->
            console.log "+++ SITE INDEX #{wikiName} : unable to delete update flag" if err


        
  itself
