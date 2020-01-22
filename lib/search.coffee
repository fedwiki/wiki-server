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
writeFileAtomic = require 'write-file-atomic'
_ = require 'lodash'
mkdirp = require 'mkdirp'

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

  working = false

  searchPageUpdate = (slug, page, origStory, cb) ->
    # to update we have to remove the page first, and then readd it
    timeLabel = "SITE INDEX update #{slug} - #{wikiName}"
    console.time timeLabel
    origText = origStory.reduce( extractPageText, '')
    try
      siteIndex.remove {
        'id': slug
        'title': page.title
        'content': origText
      }
    catch err
      # swallow error, if the page was not in index
      console.log "SITE INDEX *** removing #{slug} from index failed", err unless err.message.includes('not in the index')

    newText = page.story.reduce( extractPageText, '')
    siteIndex.add {
      'id': slug
      'title': page.title
      'content': newText
    }
    console.timeEnd timeLabel
    cb()

  searchPageRemove = (slug, title, origStory, cb) ->
    # remove page from index
    timeLabel = "SITE INDEX page remove #{slug} - #{wikiName}"
    console.time timeLabel
    origText = origStory.reduce( extractPageText, '')
    try
      siteIndex.remove {
        'id': slug
        'title': title
        'content': origText
      }
    catch err
      # swallow error, if the page was not in index
      console.log "removing #{slug} from index #{wikiName} failed", err unless err.message.includes('not in the index')
    console.timeEnd timeLabel
    cb()

  searchSave = (siteIndex, cb) ->
    # save index to file
    timeLabel = "SITE INDEX #{wikiName} : Saved"
    console.time timeLabel

    fs.exists argv.status, (exists) ->
      if exists
        writeFileAtomic siteIndexLoc, JSON.stringify(siteIndex), (e) ->
          console.timeEnd timeLabel
          return cb(e) if e
          cb()
      else
        mkdirp argv.status, ->
        writeFileAtomic siteIndexLoc, JSON.stringify(siteIndex), (e) ->
          console.timeEnd timeLabel
          return cb(e) if e
          cb()


  searchRestore = (cb) ->
    # restore index, or create if it doesn't already exist
    timeLabel = "SITE INDEX #{wikiName} : Restored"
    console.time timeLabel
    fs.exists siteIndexLoc, (exists) ->
      if exists
        fs.readFile(siteIndexLoc, (err, data) ->
          return cb(err) if err
          try
            siteIndex = miniSearch.loadJSON data,
              fields: ['title', 'content']
          catch e
            return cb(e)
          console.timeEnd timeLabel
          process.nextTick( ->
            serial(queue.shift())))

  serial = (item) ->
    if item
      switch item.action
        when "update"
          itself.start()
          searchPageUpdate(item.slug, item.page, item.origStory, (e) ->
            process.nextTick( ->
              serial(queue.shift())
            )
          )
        when "remove"
          itself.start()
          searchPageRemove(item.slug, item.title, item.origStory, (e) ->
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

  extractPageText = (pageText, currentItem) ->
    switch currentItem.type
      when 'paragraph'
        pageText += ' ' + currentItem.text.replace /\[{1,2}|\]{1,2}/g, ''
      when 'markdown'
        # really need to extract text from the markdown, but for now just remove link brackets...
        pageText += ' ' + currentItem.text.replace /\[{1,2}|\]{1,2}/g, ''
      when 'html'
        pageText += ' ' + currentItem.text.replace /<[^>]*>/g, ''
      else
        if currentItem.text?
          for line in currentItem.text.split /\r\n?|\n/
            pageText += ' ' + line.replace /\[{1,2}|\]{1,2}/g, '' unless line.match /^[A-Z]+[ ].*/
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

    timeLabel = "SITE INDEX #{wikiName} : Created"
    console.time timeLabel

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
            pageText = page.story.reduce( extractPageText, '')
            siteIndex.add {
              'id': slug
              'title': page.title
              'content': pageText
            }
            resolve()
  
      Promise.all(indexPromises)
      .then () ->
        console.timeEnd timeLabel
        process.nextTick ( ->
          serial(queue.shift()))
      
  itself.removePage = (slug, title, origStory) ->
    action = "remove"
    queue.push({action, slug, title, origStory})
    if Array.isArray(siteIndex) and !working
      itself.start()
      searchRestore (e) ->
        console.log "SITE INDEX *** Problems restoring search index #{wikiName}:" + e if e
        itself.createIndex(searchPageHandler)
    else
      serial(queue.shift()) unless working

  itself.update = (slug, page, origStory) ->
    action = "update"
    queue.push({action, slug, page, origStory})
    if Array.isArray(siteIndex) and !working
      itself.start()
      searchRestore( (e) ->
        console.log "SITE INDEX *** Problems restoring search index #{wikiName}:" + e if e
        itself.createIndex(searchPageHandler))
    else
      serial(queue.shift()) unless working
        
  itself
