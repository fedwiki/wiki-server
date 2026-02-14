/*
 * Federated Wiki : Node Server
 *
 * Asset routes: favicon, theme, proxy.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export default ({ app, authorized, cors, argv }) => {
  // ---- Theme ----

  app.get(/^\/theme\/(\w+\.\w+)$/, cors, (req, res) => {
    res.sendFile(path.join(argv.status, 'theme', req.params[0]), { dotfiles: 'allow' }, e => {
      if (e) {
        if (req.path === '/theme/style.css') {
          res.set('Content-Type', 'text/css')
          res.send('')
        } else {
          res.sendStatus(404)
        }
      }
    })
  })

  // ---- Favicon ----

  const favLoc = path.join(argv.status, 'favicon.png')
  const defaultFavLoc = path.join(argv.root, 'default-data', 'status', 'favicon.png')

  app.get('/favicon.png', cors, async (req, res) => {
    try {
      await fsp.access(favLoc)
      res.sendFile(favLoc, { dotfiles: 'allow' })
    } catch {
      res.sendFile(defaultFavLoc, { dotfiles: 'allow' })
    }
  })

  app.post('/favicon.png', authorized, async (req, res) => {
    const favicon = req.body.image.replace(/^data:image\/png;base64,/, '')
    const buf = Buffer.from(favicon, 'base64')
    try {
      await fsp.mkdir(argv.status, { recursive: true })
      await fsp.writeFile(favLoc, buf)
      res.send('Favicon Saved')
    } catch (e) {
      res.e(e)
    }
  })

  app.get(/^\/remote\/([a-zA-Z0-9:.-]+\/favicon.png)$/, (req, res) => {
    res.redirect(`http://${req.params[0]}`)
  })

  // ---- Proxy ----

  app.get('/proxy/*splat', authorized, async (req, res) => {
    const pathParts = req.originalUrl.split('/')
    const remoteHost = pathParts[2]
    pathParts.splice(0, 3)
    const remoteResource = pathParts.join('/')
    const requestURL = 'http://' + remoteHost + '/' + remoteResource
    console.log('PROXY Request: ', requestURL)
    if (
      requestURL.endsWith('.json') ||
      requestURL.endsWith('.png') ||
      requestURL.endsWith('.jpg') ||
      pathParts[0] === 'plugin'
    ) {
      try {
        const fetchRes = await fetch(requestURL, { signal: AbortSignal.timeout(2000) })
        if (fetchRes.ok) {
          res.set('content-type', fetchRes.headers.get('content-type'))
          res.set('last-modified', fetchRes.headers.get('last-modified'))
          await pipeline(fetchRes.body, res)
        } else {
          res.status(fetchRes.status).end()
        }
      } catch (err) {
        console.log('ERROR: Proxy Request ', requestURL, err)
        res.status(500).end()
      }
    } else {
      res.status(400).end()
    }
  })
}
