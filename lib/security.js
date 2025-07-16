/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-node-server/blob/master/LICENSE.txt
 */
// **security.js**
// Module for default site security.
//
// This module is not intented for use, but is here to catch a problem with
// configuration of security. It does not provide any authentication, but will
// allow the server to run read-only.

// #### Requires ####
import fs from 'node:fs'

// Export a function that generates security handler
// when called with options object.
export default (log, loga, argv) => {
  const security = {}

  // #### Private utility methods. ####

  const user = ''

  let owner = ''

  // save the admin user, and location of the identity file
  const { admin, id: idFile } = argv

  // #### Public stuff ####

  security.authenticate_session = () => {
    ;(req, res, next) => {
      // not possible to login, so always false
      req.isAuthenticated = () => false
      return next()
    }
  }

  // Retrieve owner infomation from identity file in status directory
  security.retrieveOwner = cb => {
    fs.access(idFile, fs.constants.F_OK, err => {
      if (!err) {
        fs.readFile(idFile, (err, data) => {
          if (err) return cb(err)
          owner += data
          cb()
        })
      } else {
        owner = ''
        cb()
      }
    })
  }

  // Return the owners name
  security.getOwner = () => {
    let ownerName
    if (!owner.name) {
      ownerName = ''
    } else {
      ownerName = owner.name
    }
    return ownerName
  }
  security.getUser = req => {
    return ''
  }

  security.isAuthorized = req => {
    // nobody is authorized - everything is read-only
    // unless legacy support, when unclaimed sites can be editted.
    if (owner == '') {
      if (argv.security_legacy) {
        return true
      } else {
        return false
      }
    } else {
      return false
    }
  }
  // Wiki server admin
  security.isAdmin = () => {
    return false
  }
  security.defineRoutes = (app, cors, updateOwner) => {
    // default security does not have any routes
  }

  return security
}
