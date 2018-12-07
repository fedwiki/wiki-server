###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###

# **server.coffee** is the main guts of the express version
# of (Smallest Federated Wiki)[https://github.com/WardCunningham/Smallest-Federated-Wiki].
# The CLI and Farm are just front ends
# for setting arguments, and spawning servers.  In a complex system
# you would probably want to replace the CLI/Farm with your own code,
# and use server.coffee directly.
#
#### Dependencies ####
# anything not in the standard library is included in the repo, or
# can be installed with an:
#     npm install

# Standard lib
fs = require 'fs'
path = require 'path'
http = require 'http'

# From npm
mkdirp = require 'mkdirp'
express = require 'express'
hbs = require 'express-hbs'
glob = require 'glob'
async = require 'async'
f = require('flates')
sanitize = require '@mapbox/sanitize-caja'

# Express 4 middleware
logger = require 'morgan'
cookieParser = require 'cookie-parser'
methodOverride = require 'method-override'
## session = require 'express-session'
sessions = require 'client-sessions'
bodyParser = require 'body-parser'
errorHandler = require 'errorhandler'
request = require 'request'


# Local files
random = require './random_id'
defargs = require './defaultargs'
resolveClient = require 'wiki-client/lib/resolve'
pluginsFactory = require './plugins'
sitemapFactory = require './sitemap'

render = (page) ->
  return f.div({class: "twins"}, f.p('')) + '\n' +
  f.div({class: "header"}, f.h1(
    f.a({href: '/', style: 'text-decoration: none'},
      f.img({height: '32px', src: '/favicon.png'})) +
      ' ' + (page.title))) + '\n' +
    f.div {class: "story"},
      page.story.map((story) ->
        if story.type is 'paragraph'
          f.div {class: "item paragraph"}, f.p(resolveClient.resolveLinks(story.text))
        else if story.type is 'image'
          f.div {class: "item image"},
            f.img({class: "thumbnail", src: story.url}),
            f.p(resolveClient.resolveLinks(story.text or story.caption or 'uploaded image'))
        else if story.type is 'html'
          f.div {class: "item html"},
          f.p(resolveClient.resolveLinks(story.text or '', sanitize))
        else f.div {class: "item"}, f.p(resolveClient.resolveLinks(story.text or ''))
      ).join('\n')

# Set export objects for node and coffee to a function that generates a sfw server.
module.exports = exports = (argv) ->
  # Create the main application object, app.
  app = express()

  # remove x-powered-by header
  app.disable('x-powered-by')

  # defaultargs.coffee exports a function that takes the argv object
  # that is passed in and then does its
  # best to supply sane defaults for any arguments that are missing.
  argv = defargs(argv)

  app.startOpts = argv

  log = (stuff...) ->
    console.log stuff if argv.debug

  loga = (stuff...) ->
    console.log stuff


  ourErrorHandler = (req, res, next) ->
    fired = false
    res.e = (error, status) ->
      if !fired
        fired = true
        res.statusCode = status or 500
        res.end 'Server ' + error
        log "Res sent:", res.statusCode, error
      else
        log "Already fired", error
    next()

  # Require the database adapter and initialize it with options.
  app.pagehandler = pagehandler = require(argv.database.type)(argv)

  # Require the sitemap adapter and initialize it with options.
  app.sitemaphandler = sitemaphandler = sitemapFactory(argv)

  # Require the security adapter and initialize it with options.
  app.securityhandler = securityhandler = require(argv.security_type)(log, loga, argv)

  # If the site is owned, owner will contain the name of the owner
  owner = ''

  # If the user is logged in, user will contain their identity
  user = ''

  # Called from authentication when the site is claimed,
  # to update the name of the owner held here.
  updateOwner = (id) ->
    owner = id


  #### Middleware ####
  #
  # Allow json to be got cross origin.
  cors = (req, res, next) ->
    res.header 'Access-Control-Allow-Origin', req.get('origin')||'*'
    next()


  remoteGet = (remote, slug, cb) ->
    [host, port] = remote.split(':')
    getopts = {
      host: host
      port: port or 80
      path: "/#{slug}.json"
    }
    # TODO: This needs more robust error handling, just trying to
    # keep it from taking down the server.
    http.get(getopts, (resp) ->
      responsedata = ''
      resp.on 'data', (chunk) ->
        responsedata += chunk

      resp.on 'error', (e) ->
        cb(e, 'Page not found', 404)

      resp.on 'end', ->
        if resp.statusCode == 404
          cb(null, 'Page not found', 404)
        else if responsedata
          cb(null, JSON.parse(responsedata), resp.statusCode)
        else
          cb(null, 'Page not found', 404)

    ).on 'error', (e) ->
      cb(e, 'Page not found', 404)

  #### Express configuration ####
  # Set up all the standard express server options,
  # including hbs to use handlebars/mustache templates
  # saved with a .html extension, and no layout.

  app.set('views', path.join(__dirname, '..', '..', 'wiki-client', '/views'))
  app.set('view engine', 'html')
  app.engine('html', hbs.express4())
  app.set('view options', layout: false)

    # use logger, at least in development, probably needs a param to configure (or turn off).
    # use stream to direct to somewhere other than stdout.
  app.use(logger('tiny'))
  app.use(cookieParser())
  app.use(bodyParser.json({ limit: argv.uploadLimit}))
  app.use(bodyParser.urlencoded({ extended: true, limit: argv.uploadLimit}))
  app.use(methodOverride())
  cookieValue = {
    httpOnly: true
  }
  cookieValue['domain'] = argv.wiki_domain if argv.wiki_domain
  # use secureProxy as TLS is terminated in outside the node process
  cookieValue['secureProxy'] = true if argv.secure_cookie
  app.use(sessions({
    cookieName: 'wikiSession',
    requestKey: 'session',
    secret: argv.cookieSecret,
    # make the session session_duration days long
    duration: argv.session_duration * 24 * 60 * 60 * 1000,
    # add 12 hours to session if less than 12 hours to expiry
    activeDuration: 24 * 60 * 60 * 1000,
    cookie: cookieValue
    }))

  app.use(ourErrorHandler)

  # Add static route to the client
  app.use(express.static(argv.client))

  ##### Define security routes #####
  securityhandler.defineRoutes app, cors, updateOwner

  # Add static route to assets
  app.use('/assets', cors, express.static(argv.assets))

  # Add static routes to the plugins client.
  glob "wiki-plugin-*/client", {cwd: argv.packageDir}, (e, plugins) ->
    plugins.map (plugin) ->
      pluginName = plugin.slice(12, -7)
      pluginPath = '/plugins/' + pluginName
      app.use(pluginPath, express.static(path.join(argv.packageDir, plugin)))

  # Add static routes to the security client.
  if argv.security != './security'
    app.use('/security', express.static(path.join(argv.packageDir, argv.security_type, 'client')))


  ##### Set up standard environments. #####
  # In dev mode turn on console.log debugging as well as showing the stack on err.
  if 'development' == app.get('env')
    app.use(errorHandler())
    argv.debug = console? and true

  # Show all of the options a server is using.
  log argv

  #### Routes ####
  # Routes currently make up the bulk of the Express port of
  # Smallest Federated Wiki. Most routes use literal names,
  # or regexes to match, and then access req.params directly.

  ##### Redirects #####
  # Common redirects that may get used throughout the routes.
  index = argv.home + '.html'

  oops = '/oops'

  ##### Get routes #####
  # Routes have mostly been kept together by http verb, with the exception
  # of the openID related routes which are at the end together.

  # Main route for initial contact.  Allows us to
  # link into a specific set of pages, local and remote.
  # Can also be handled by the client, but it also sets up
  # the login status, and related footer html, which the client
  # relies on to know if it is logged in or not.
  app.get ///^((/[a-zA-Z0-9:.-]+/[a-z0-9-]+(_rev\d+)?)+)/?$///, (req, res, next) ->
    urlPages = (i for i in req.params[0].split('/') by 2)[1..]
    urlLocs = (j for j in req.params[0].split('/')[1..] by 2)
    if ['plugin', 'auth'].indexOf(urlLocs[0]) > -1
      return next()
    title = urlPages[..].pop().replace(/-+/g,' ')
    user = securityhandler.getUser(req)
    info = {
      title
      pages: []
      authenticated: if user
        true
      else
        false
      user: user
      seedNeighbors: argv.neighbors
      owned: if owner
        true
      else
        false
      isOwner: if securityhandler.isAuthorized(req)
        true
      else
        false
      ownedBy: if owner
        owner
      else
        ''
    }
    for page, idx in urlPages
      if urlLocs[idx] is 'view'
        pageDiv = {page}
      else
        pageDiv = {page, origin: """data-site=#{urlLocs[idx]}"""}
      info.pages.push(pageDiv)
    res.render('static.html', info)

  app.get ///([a-z0-9-]+)\.html$///, (req, res, next) ->
    slug = req.params[0]
    log(slug)
    if slug is 'runtests'
      return next()
    pagehandler.get slug, (e, page, status) ->
      if e then return res.e e
      if status is 404
        return res.status(status).send(page)
      page.title ||= slug.replace(/-+/g,' ')
      page.story ||= []
      user = securityhandler.getUser(req)

      info = {
        title: page.title
        pages: [
          page: slug
          generated: """data-server-generated=true"""
          story: render(page)
        ]
        authenticated: if user
          true
        else
          false
        user: user
        seedNeighbors: argv.neighbors
        owned: if owner
          true
        else
          false
        isOwner: if securityhandler.isAuthorized(req)
          true
        else
          false
        ownedBy: if owner
          owner
        else
          ''
      }
      res.render('static.html', info)

  app.get ///system/factories.json///, (req, res) ->
    res.status(200)
    res.header('Content-Type', 'application/json')
# Plugins are located in packages in argv.packageDir, with package names of the form wiki-plugin-*
    glob path.join(argv.packageDir, 'wiki-plugin-*', 'factory.json'), (e, files) ->
      if e then return res.e(e)

      doFactories = (file, cb) ->
        fs.readFile file, (err, data) ->
          return cb() if err
          try
            factory = JSON.parse data
            cb null, factory
          catch err
            return cb()

      async.map files, doFactories, (e, factories) ->
        res.e if e
        res.end(JSON.stringify factories)


  ###### Json Routes ######
  # Handle fetching local and remote json pages.
  # Local pages are handled by the pagehandler module.
  app.get ///^/([a-z0-9-]+)\.json$///, cors, (req, res) ->
    file = req.params[0]
    pagehandler.get file, (e, page, status) ->
      if e then return res.e e
      res.status(status or 200).send(page)

  # Remote pages use the http client to retrieve the page
  # and sends it to the client.  TODO: consider caching remote pages locally.
  app.get ///^/remote/([a-zA-Z0-9:\.-]+)/([a-z0-9-]+)\.json$///, (req, res) ->
    remoteGet req.params[0], req.params[1], (e, page, status) ->
      if e
        log "remoteGet error:", e
        return res.e e
      res.status(status or 200).send(page)


  ###### Theme Routes ######
  # If themes doesn't exist send 404 and let the client
  # deal with it.
  app.get /^\/theme\/(\w+\.\w+)$/, cors, (req,res) ->
    res.sendFile(path.join(argv.status, 'theme', req.params[0]), (e) ->
      if (e)
        # swallow the error if the theme does not exist...
        if req.path is '/theme/style.css'
          res.set('Content-Type', 'text/css')
          res.send('')
        else
          res.sendStatus(404)
      )

  ###### Favicon Routes ######
  # If favLoc doesn't exist send 404 and let the client
  # deal with it.
  favLoc = path.join(argv.status, 'favicon.png')
  app.get '/favicon.png', cors, (req,res) ->
    res.sendFile(favLoc)

  authorized = (req, res, next) ->
    if securityhandler.isAuthorized(req)
      next()
    else
      console.log 'rejecting', req.path
      res.sendStatus(403)

  # Accept favicon image posted to the server, and if it does not already exist
  # save it.
  app.post '/favicon.png', authorized, (req, res) ->
    favicon = req.body.image.replace(///^data:image/png;base64,///, "")
    buf = new Buffer(favicon, 'base64')
    fs.exists argv.status, (exists) ->
      if exists
        fs.writeFile favLoc, buf, (e) ->
          if e then return res.e e
          res.send('Favicon Saved')

      else
        mkdirp argv.status, ->
          fs.writeFile favLoc, buf, (e) ->
            if e then return res.e e
            res.send('Favicon Saved')

  # Redirect remote favicons to the server they are needed from.
  app.get ///^/remote/([a-zA-Z0-9:\.-]+/favicon.png)$///, (req, res) ->
    remotefav = "http://#{req.params[0]}"
    res.redirect(remotefav)

  ###### Recycler Routes ######
  # These routes are only available to the site's owner

  # Give the recycler a standard flag - use the Taiwan symbol as the use of
  # negative space outward pointing arrows nicely indicates that items can be removed
  recyclerFavLoc = path.join(argv.root, 'default-data', 'status', 'recycler.png')
  app.get '/recycler/favicon.png', authorized, (req, res) ->
    res.sendFile(recyclerFavLoc)

  # Send an array of pages currently in the recycler via json
  app.get '/recycler/system/slugs.json', authorized, (req, res) ->
    fs.readdir argv.recycler, (e, files) ->
      if e then return res.e e
      doRecyclermap = (file, cb) ->
        pagehandler.get file, (e, page, status) ->
          return cb() if file.match /^\./
          if e
            console.log 'Problem building recycler map:', file, 'e: ',e
            return cb()
          cb null, {
            slug:  file
            title: page.title
          }

      async.map files, doRecyclermap, (e, recyclermap) ->
        return cb(e) if e
        res.send(recyclermap)

  # Fetching page from the recycler
  #///^/([a-z0-9-]+)\.json$///
  app.get ///^/recycler/([a-z0-9-]+)\.json$///, authorized, (req, res) ->
    file = 'recycler/' + req.params[0]
    pagehandler.get file, (e, page, status) ->
      if e then return res.e e
      res.status(status or 200).send(page)

  # Delete page from the recycler
  app.delete ///^/recycler/([a-z0-9-]+)\.json$///, authorized, (req, res) ->
    file = 'recycler/' + req.params[0]
    pagehandler.delete file, (err) ->
      if err then res.status(500).send(err)
      res.status(200).send('')


  ###### Meta Routes ######
  # Send an array of pages in the database via json
  app.get '/system/slugs.json', cors, (req, res) ->
    fs.readdir argv.db, (e, files) ->
      if e then return res.e e
      res.send(files)

# Returns a list of installed plugins. (does this get called anymore!)
  app.get '/system/plugins.json', cors, (req, res) ->
    glob "wiki-plugin-*", {cwd: argv.packageDir}, (e, files) ->
      if e then return res.e e
      # extract the plugin name from the name of the directory it's installed in
      files = files.map (file) -> file.slice(12)
      res.send(files)

#
  sitemapLoc = path.join(argv.status, 'sitemap.json')
  app.get '/system/sitemap.json', cors, (req, res) ->
    fs.exists sitemapLoc, (exists) ->
      if exists
        res.sendFile(sitemapLoc)
      else
        # only createSitemap if we are not already creating one
        sitemaphandler.createSitemap (pagehandler) if !sitemaphandler.isWorking()
        # wait for the sitemap file to be written, before sending
        sitemaphandler.once 'finished', ->
          res.sendFile(sitemapLoc)

  xmlSitemapLoc = path.join(argv.status, 'sitemap.xml')
  app.get '/sitemap.xml', (req, res) ->
    fs.exists sitemapLoc, (exists) ->
      if exists
        res.sendFile(xmlSitemapLoc)
      else
        sitemaphandler.createSitemap (pagehandler) if !sitemaphandler.isWorking()
        sitemaphandler.once 'finished', ->
          res.sendFile(xmlSitemapLoc)


  app.get '/system/export.json', cors, (req, res) ->
    pagehandler.pages (e, sitemap) ->
      return res.e(e) if e
      async.map(
        sitemap,
        (stub, done) ->
          pagehandler.get(stub.slug, (error, page) ->
            return done(e) if e
            done(null, {slug: stub.slug, page})
          )
        ,
        (e, pages) ->
          return res.e(e) if e
          res.json(pages.reduce( (dict, combined) ->
            dict[combined.slug] = combined.page
            dict
          , {}))
      )


  ##### Proxy routes #####

  app.get '/proxy/*', authorized, (req, res) ->
    pathParts = req.originalUrl.split('/')
    remoteHost = pathParts[2]
    pathParts.splice(0,3)
    remoteResource = pathParts.join('/')
    requestURL = 'http://' + remoteHost + '/' + remoteResource
    console.log("PROXY Request: ", requestURL)
    if requestURL.endsWith('.json') or requestURL.endsWith('.png') or pathParts[0] is "plugin"
      requestOptions = {
        host: remoteHost
        port: 80
        path: remoteResource
      }
      try
        request
          .get(requestURL, requestOptions)
          .on('error', (err) ->
            console.log("ERROR: Request ", requestURL, err))
          .pipe(res)
      catch error
        console.log "PROXY Error", error
        res.status(500).end()
    else
      res.status(400).end()


  ##### Put routes #####

  app.put /^\/page\/([a-z0-9-]+)\/action$/i, authorized, (req, res) ->
    action = JSON.parse(req.body.action)
    # Handle all of the possible actions to be taken on a page,
    actionCB = (e, page, status) ->
      #if e then return res.e e
      if status is 404
        res.status(status).send(page)
      # Using Coffee-Scripts implicit returns we assign page.story to the
      # result of a list comprehension by way of a switch expression.
      try
        page.story = switch action.type
          when 'move'
            action.order.map (id) ->
              page.story.filter((para) ->
                id == para.id
              )[0] or throw('Ignoring move. Try reload.')

          when 'add'
            idx = page.story.map((para) -> para.id).indexOf(action.after) + 1
            page.story.splice(idx, 0, action.item)
            page.story

          when 'remove'
            page.story.filter (para) ->
              para?.id != action.id

          when 'edit'
            page.story.map (para) ->
              if para.id is action.id
                action.item
              else
                para


          when 'create', 'fork'
            page.story or []

          else
            log "Unfamiliar action:", action
            #page.story
            throw('Unfamiliar action ignored')
      catch e
        return res.e e

      # Add a blank journal if it does not exist.
      # And add what happened to the journal.
      if not page.journal
        page.journal = []
      if action.fork
        page.journal.push({type: "fork", site: action.fork})
        delete action.fork
      page.journal.push(action)
      pagehandler.put req.params[0], page, (e) ->
        if e then return res.e e
        res.send('ok')
        # log 'saved'

      # update sitemap
      sitemaphandler.update(req.params[0], page)

    # log action

    # If the action is a fork, get the page from the remote server,
    # otherwise ask pagehandler for it.
    if action.fork
      pagehandler.saveToRecycler req.params[0], (err) ->
        if err then console.log "Error saving #{req.params[0]} before fork: #{err}"
        remoteGet(action.fork, req.params[0], actionCB)
    else if action.type is 'create'
      # Prevent attempt to write circular structure
      itemCopy = JSON.parse(JSON.stringify(action.item))
      pagehandler.get req.params[0], (e, page, status) ->
        if e then return actionCB(e)
        unless status is 404
          res.status(409).send('Page already exists.')
        else
          actionCB(null, itemCopy)

    else if action.type == 'fork'
      pagehandler.saveToRecycler req.params[0], (err) ->
        if err then console.log "Error saving #{req.params[0]} before fork: #{err}"
        if action.item # push
          itemCopy = JSON.parse(JSON.stringify(action.item))
          delete action.item
          actionCB(null, itemCopy)
        else # pull
          remoteGet(action.site, req.params[0], actionCB)
    else
      pagehandler.get(req.params[0], actionCB)

  # Return the oops page when login fails.
  app.get '/oops', (req, res) ->
    res.statusCode = 403
    res.render('oops.html', {msg:'This is not your wiki!'})

  # Traditional request to / redirects to index :)
  app.get '/', (req, res) ->
    home = path.join argv.assets, 'home', 'index.html'
    fs.stat home, (err, stats) ->
      if err || !stats.isFile()
        res.redirect(index)
      else
        res.redirect("/assets/home/index.html")

  ##### Delete Routes #####

  app.delete ///^/([a-z0-9-]+)\.json$///, authorized, (req, res) ->
    pageFile = req.params[0]
    pagehandler.delete pageFile, (err) ->
      if err
        res.status(500).send(err)
      else
        sitemaphandler.removePage pageFile
        res.status(200).send('')



  #### Start the server ####
  # Wait to make sure owner is known before listening.
  securityhandler.retrieveOwner (e) ->
    # Throw if you can't find the initial owner
    if e then throw e
    owner = securityhandler.getOwner()
    console.log "owner: " + owner
    app.emit 'owner-set'

  app.on 'running-serv', (server) ->
    ### Plugins ###
    # Should replace most WebSocketServers below.
    plugins = pluginsFactory(argv)
    plugins.startServers({argv, app})
    ### Sitemap ###
    # create sitemap at start-up
    sitemaphandler.createSitemap(pagehandler)


  # Return app when called, so that it can be watched for events and shutdown with .close() externally.
  app
