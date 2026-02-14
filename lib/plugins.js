/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// Support server-side plugins

import fsp from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export default argv => {
  const plugins = {}

  const startServer = async (params, plugin) => {
    const server = `${argv.packageDir}/${plugin}/server/server.js`
    try {
      await fsp.access(server)
    } catch {
      return
    }
    try {
      console.log('starting plugin', plugin)
      const exported = await import(pathToFileURL(server))
      plugins[plugin] = exported
      plugins[plugin].startServer?.(params)
    } catch (e) {
      console.log('failed to start plugin', plugin, e?.stack || e)
    }
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
