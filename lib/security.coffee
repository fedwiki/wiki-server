###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-node-server/blob/master/LICENSE.txt
###
# **security.coffee**
# Module for default site security.
#
# This module is not intented for use, but is here to catch a problem with
# configuration of security. It does not provide any authentication, but will
# allow the server to run read-only.

#### Requires ####
fs = require 'fs'


# Export a function that generates security handler
# when called with options object.
module.exports = exports = (log, loga, argv) ->
  security={}

  #### Private utility methods. ####

  user = ''

  owner = ''

  # save the location of the identity file
  idFile = argv.id

  #### Public stuff ####

  security.authenticate_session = ->
    (req, res, next) ->
      # not possible to login, so always false
      req.isAuthenticated = ->
        return false
      next()

  # Retrieve owner infomation from identity file in status directory
  security.retrieveOwner = (cb) ->
    fs.exists idFile, (exists) ->
      if exists
        fs.readFile(idFile, (err, data) ->
          if err then return cb err
          owner += data
          cb())
      else
        owner = ''
        cb()

  # Return the owners name
  security.getOwner = ->
    if ~owner.indexOf '@'
      ownerName = owner.substr(0, owner.indexOf('@'))
    else
      ownerName = owner
    ownerName

  security.isAuthorized = ->
    # If site is not owned, everybody is authorized. Same as original...
    if owner == ''
      return true
    else
      return false

  security.login = () ->
    # should never be called...
    (req, res) ->
      res.send "Not Implemented", 501

  security.logout = () ->
    # should never be called...
    (req, res) ->
      res.send "Not Implemented", 501

  security
