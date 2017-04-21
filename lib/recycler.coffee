###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###
# **recycler.coffee••
# Module for recovering pages that have been forked over.
# Uses client site adapter so pages appear as if on a seperate wiki.

#### Requires ####
fs = require 'fs'
path = require 'path'
events = require 'events'
glob = require 'glob'

mkdirp = require 'mkdirp'
async = require 'async'

module.exports = exports = (argv) ->
  mkdirp argv.recycler, (e) ->
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

  # Reads and writes are async, but serially queued to aviod race conditions
  queue = []

  # Main file io function
  fileio = (file, page, cb) ->
    loc = path.join(arvg.recycler, file)
    
