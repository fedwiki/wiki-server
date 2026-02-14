/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-node-server/blob/master/LICENSE.txt
 */

// **security.js**
// Default site security module.
//
// Not intended for production use — exists to catch misconfiguration.
// Provides no authentication. The server runs read-only unless
// security_legacy is enabled on an unclaimed site.

import fsp from 'node:fs/promises'

export default (log, loga, argv) => {
  const security = {}

  let owner = ''

  const { admin, id: idFile } = argv

  security.retrieveOwner = async () => {
    try {
      await fsp.access(idFile)
      const data = await fsp.readFile(idFile, 'utf8')
      owner += data
    } catch {
      owner = ''
    }
  }

  security.getOwner = () => {
    return owner.name ? owner.name : ''
  }

  security.getUser = req => {
    return ''
  }

  security.isAuthorized = req => {
    if (owner == '') {
      return !!argv.security_legacy
    }
    return false
  }

  security.isAdmin = () => {
    if (argv.security_legacy && argv.test) {
      return true
    }
    return false
  }

  security.defineRoutes = (app, cors, updateOwner) => {
    // default security has no routes
  }

  return security
}
