/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// support server-side plugins

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
// import forward from './forward.cjs'; // Uncomment if needed and adjust import style if it's not a default export

export default argv => {
  // NOTE: plugins are now in their own package directories alongside this one...
  // Plugins are in directories of the form wiki-package-*
  // those with a server component will have a server directory

  const plugins = {}

  // http://stackoverflow.com/questions/10914751/loading-node-js-modules-dynamically-based-on-route

  const startServer = (params, plugin) => {
    const server = `${argv.packageDir}/${plugin}/server/server.js`
    fs.access(server, fs.constants.F_OK, err => {
      if (!err) {
        console.log('starting plugin', plugin)
        import(pathToFileURL(server))
          .then(exported => {
            plugins[plugin] = exported
            plugins[plugin].startServer?.(params)
          })
          .catch(e => {
            console.log('failed to start plugin', plugin, e?.stack || e)
          })
      }
    })
  }

  const startServers = params => {
    const dependencies = params.packageJson.dependencies
    Object.keys(dependencies)
      .filter(depend => depend.startsWith('wiki-plugin'))
      .forEach(plugin => {
        startServer(params, plugin)
      })
  }

  return { startServers }
}
