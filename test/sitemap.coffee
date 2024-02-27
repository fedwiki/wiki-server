request = require 'supertest'
fs = require 'fs'
server = require '..'
path = require 'path'
random = require '../lib/random_id'
testid = random()
argv = require('../lib/defaultargs.coffee')({data: path.join('/tmp', 'sfwtests', testid), port: 55556, security_legacy: true})

describe 'sitemap', ->
  app = {}
  runningServer = null
  beforeEach((done) ->
    app = server(argv)
    app.once("owner-set", ->
      runningServer = app.listen app.startOpts.port, app.startOpts.host, done
    ))
  afterEach () ->
    runningServer.close()


  request = request('http://localhost:55556')

  # location of the sitemap
  sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')

  it 'new site should have an empty sitemap', () ->
    request
    .get('/system/sitemap.json')
    .expect(200)
    .expect('Content-Type', /json/)
    .then (res) ->
      res.body.should.be.empty
    , (err) ->
      throw err


  it 'creating a page should add it to the sitemap', () ->
    body = JSON.stringify({
      type: 'create'
      item: {
        title: "Asdf Test Page"
        story: [
          {id: "a1", type: "paragraph", text: "this is the first paragraph"}
          {id: "a2", type: "paragraph", text: "this is the second paragraph"}
          {id: "a3", type: "paragraph", text: "this is the third paragraph"}
          {id: "a4", type: "paragraph", text: "this is the fourth paragraph"}
          ]
      }
      date: 1234567890123
      })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(200)
      .then (res) ->
        # sitemap update does not happen until after the put has returned, so wait for it to finish
        app.sitemaphandler.once 'finished', ->
          try
            sitemap = JSON.parse(fs.readFileSync(sitemapLoc))
          catch err
            throw err
          sitemap[0].slug.should.equal['adsf-test-page']
          sitemap[0].synopsis.should.equal['this is the first paragraph']
      , (err) ->
        throw err

  it 'synopsis should reflect edit to first paragraph', () ->
    body = JSON.stringify({
      type: 'edit'
      item: {id: 'a1', type: 'paragraph', text: 'edited'}
      id: 'a1'
    })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(200)
      .then (res) ->
        app.sitemaphandler.once 'finished', ->
          try
            sitemap = JSON.parse(fs.readFileSync(sitemapLoc))
          catch err
            throw err
          sitemap[0].slug.should.equal['adsf-test-page']
          sitemap[0].synopsis.should.equal['edited']
      , (err) ->
        throw err

  it 'deleting a page should remove it from the sitemap', () ->

    request
      .delete('/adsf-test-page.json')
      .send()
      .expect(200)
      .then (res) ->
        app.sitemaphandler.once 'finished', ->
          try
            sitemap = JSON.parse(fs.readFileSync(sitemapLoc))
          catch error
            throw err
          sitemap.should.be.empty
      , (err) ->
        throw err



  after( ->
    app.close() if app.close)
