/*
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
 */

// **server.js** — App creation, middleware, startup.
// Route logic lives in routes/*.js modules.

import fs from 'node:fs'
import path from 'node:path'

import express from 'express'
import hbs from 'express-hbs'
import logger from 'morgan'
import cookieParser from 'cookie-parser'
import methodOverride from 'method-override'
import sessions from 'client-sessions'
import bodyParser from 'body-parser'
import errorHandler from 'errorhandler'

import defargs from './defaultargs.js'
import pluginsFactory from './plugins.js'
import sitemapFactory from './sitemap.js'
import searchFactory from './search.js'
import { createRequire } from 'module'

import mountPageRoutes from './routes/pages.js'
import mountMetaRoutes from './routes/meta.js'
import mountViewRoutes from './routes/views.js'
import mountAssetRoutes from './routes/assets.js'

const require = createRequire(import.meta.url)

export default async argv => {
  const app = express()
  app.disable('x-powered-by')

  argv = defargs(argv)

  const packageJson = JSON.parse(fs.readFileSync(argv.packageFile, 'utf8'))

  app.startOpts = argv

  const wikiName = new URL(argv.url).hostname

  const log = (...stuff) => {
    if (argv.debug) console.log(stuff)
  }
  const loga = (...stuff) => {
    console.log(stuff)
  }

  // ---- Error handler middleware ----

  const ourErrorHandler = (req, res, next) => {
    let fired = false
    res.e = (error, status) => {
      if (!fired) {
        fired = true
        res.statusCode = status || 500
        res.end('Server ' + error)
        log('Res sent:', res.statusCode, error)
      } else {
        log('Already fired', error)
      }
    }
    next()
  }

  // ---- Handlers ----

  const dbModule = await import(argv.database.type)
  const pagehandler = dbModule.default(argv)
  const sitemaphandler = sitemapFactory(argv)
  const searchhandler = searchFactory(argv)

  console.log('security_type', argv.security_type)
  const securityModule = await import(argv.security_type)
  const securityhandler = securityModule.default(log, loga, argv)

  app.pagehandler = pagehandler
  app.sitemaphandler = sitemaphandler
  app.searchhandler = searchhandler
  app.securityhandler = securityhandler

  let owner = ''

  const updateOwner = id => {
    owner = id
  }
  const getOwner = () => owner

  // ---- Middleware ----

  const cors = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.get('origin') || '*')
    next()
  }

  const authorized = (req, res, next) => {
    if (securityhandler.isAuthorized(req)) {
      next()
    } else {
      console.log('rejecting', req.path)
      res.sendStatus(403)
    }
  }

  const admin = (req, res, next) => {
    if (securityhandler.isAdmin(req)) {
      next()
    } else {
      console.log('rejecting', req.path)
      res.sendStatus(403)
    }
  }

  const staticPathOptions = {
    dotfiles: 'ignore',
    etag: true,
    immutable: false,
    lastModified: false,
    maxAge: '1h',
  }

  // ---- View engine ----

  app.set('views', path.join(require.resolve('wiki-client/package.json'), '..', 'views'))
  app.set('view engine', 'html')
  app.engine('html', hbs.express4())
  app.set('view options', { layout: false })

  // ---- Logger ----

  const colorString = str => {
    const colorReset = '\x1b[0m'
    let hash = 0
    str.split('').forEach(char => {
      hash = char.charCodeAt(0) + ((hash << 5) - hash)
    })
    let color = '\x1b[38;2'
    ;[...Array(3).keys()].forEach(i => {
      const value = (hash >> (i * 8)) & 0xff
      color += ':' + value.toString()
    })
    color += 'm'
    return color + str + colorReset
  }

  const vhost = colorString(wikiName)
  app.use(
    logger((tokens, req, res) => {
      return [
        vhost,
        tokens.method(req, res),
        tokens.url(req, res),
        tokens.status(req, res),
        tokens.res(req, res, 'content-length'),
        '-',
        tokens['response-time'](req, res),
        'ms',
      ].join(' ')
    }),
  )

  // ---- Standard middleware ----

  app.use(cookieParser())
  app.use(bodyParser.json({ limit: argv.uploadLimit }))
  app.use(bodyParser.urlencoded({ extended: true, limit: argv.uploadLimit }))
  app.use(methodOverride())

  const cookieValue = { httpOnly: true, sameSite: 'lax' }
  if (argv.wiki_domain && !argv.wiki_domain.endsWith('localhost')) {
    cookieValue.domain = argv.wiki_domain
  }
  const cookieName = argv.secure_cookie ? 'wikiTlsSession' : 'wikiSession'
  if (argv.secure_cookie) cookieValue.secureProxy = true

  app.use(
    sessions({
      cookieName,
      requestKey: 'session',
      secret: argv.cookieSecret,
      duration: argv.session_duration * 24 * 60 * 60 * 1000,
      activeDuration: 24 * 60 * 60 * 1000,
      cookie: cookieValue,
    }),
  )

  app.use(ourErrorHandler)

  // ---- Static mounts ----

  app.use(express.static(argv.client, staticPathOptions))

  securityhandler.defineRoutes(app, cors, updateOwner)

  app.use('/assets', cors, express.static(argv.assets))

  Object.keys(packageJson.dependencies)
    .filter(d => d.startsWith('wiki-plugin'))
    .forEach(plugin => {
      try {
        const clientPath = path.join(path.dirname(require.resolve(`${plugin}/package`)), 'client')
        app.use('/plugins/' + plugin.slice(12), cors, express.static(clientPath, staticPathOptions))
      } catch {
        // plugin not installed
      }
    })

  if (argv.security != './security') {
    app.use('/security', express.static(path.join(argv.packageDir, argv.security_type, 'client'), staticPathOptions))
  }

  if ('development' == app.get('env')) {
    app.use(errorHandler())
    argv.debug = true
  }

  log(argv)

  // ---- Mount routes ----

  const ctx = {
    app,
    pagehandler,
    sitemaphandler,
    searchhandler,
    securityhandler,
    packageJson,
    authorized,
    admin,
    cors,
    log,
    argv,
    getOwner,
  }

  mountViewRoutes(ctx)
  mountMetaRoutes(ctx)
  mountPageRoutes(ctx)
  mountAssetRoutes(ctx)

  // ---- Startup ----

  process.exitCode = argv.test ? 0 : 1

  await securityhandler.retrieveOwner()
  owner = securityhandler.getOwner()
  console.log('owner: ' + owner)
  app.emit('owner-set')

  app.on('running-serv', server => {
    const plugins = pluginsFactory(argv)
    plugins.startServers({ argv, app, packageJson })
    sitemaphandler.createSitemap(pagehandler)
    searchhandler.startUp(pagehandler)
  })

  return app
}
