#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import server from './lib/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const argv = {
  root: __dirname,
  port: parseInt(process.env.PORT || '3000', 10),
  data: process.env.WIKI_DATA || undefined,
  packageFile: path.join(__dirname, 'package.json'),
}

const app = await server(argv)

const { port, host } = app.startOpts

const srv = app.listen(port, host, () => {
  console.log(`wiki listening on http://${host || 'localhost'}:${port}`)
  app.emit('running-serv', srv)
})
