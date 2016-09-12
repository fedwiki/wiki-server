request = require 'supertest'
fs = require 'fs'
server = require '..'
path = require 'path'
random = require '../lib/random_id'
testid = random()
argv = require('../lib/defaultargs.coffee')({data: path.join('/tmp', 'sfwtests', testid), port: 55555, security_legacy: true})

describe 'server', ->
  app = {}
  before((done) ->
    # as starting the server this was does not create a sitemap file, create an empty one
    sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')
    fs.mkdirSync path.join('/tmp', 'sfwtests', testid)
    fs.mkdirSync path.join('/tmp', 'sfwtests', testid, 'status')
    fs.writeFileSync sitemapLoc, JSON.stringify([])

    app = server(argv)
    app.once("owner-set", ->
      app.listen app.startOpts.port, app.startOpts.host, done
    ))


  request = request('http://localhost:55555')

  # location of the test page
  loc = path.join('/tmp', 'sfwtests', testid, 'pages', 'adsf-test-page')


  it 'new site should have an empty list of pages', (done) ->
    request
      .get('/system/slugs.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .end (err, res) ->
        if err
          throw err
        res.body.should.be.empty
        done()

  it 'should create a page', (done) ->
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
      .end (err, res) ->
        if err
          throw err
        done()

  it 'should move the paragraphs to the order given ', (done) ->
    body = '{ "type": "move", "order": [ "a1", "a3", "a2", "a4"] }'

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(200)
      .end (err, res) ->
        if err
          throw err
        try
          page = JSON.parse(fs.readFileSync(loc))
        catch err
          throw err
        page.story[1].id.should.equal('a3')
        page.story[2].id.should.equal('a2')
        page.journal[1].type.should.equal('move')
        done()

  it 'should add a paragraph', (done) ->
    body = JSON.stringify({
      type: 'add'
      after: 'a2'
      item: {id: 'a5', type: 'paragraph', text: 'this is the NEW paragrpah'}
    })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(200)
      .end (err, res) ->
        if err
          throw err
        try
          page = JSON.parse(fs.readFileSync(loc))
        catch err
          throw err
        page.story.length.should.equal(5)
        page.story[3].id.should.equal('a5')
        page.journal[2].type.should.equal('add')
        done()

  it 'should remove a paragraph with given id', (done) ->
    body = JSON.stringify({
      type: 'remove'
      id: 'a2'
    })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(200)
      .end (err, res) ->
        if err
          throw err
        try
          page = JSON.parse(fs.readFileSync(loc))
        catch err
          throw err
        page.story.length.should.equal(4)
        page.story[1].id.should.equal('a3')
        page.story[2].id.should.not.equal('a2')
        page.story[2].id.should.equal('a5')
        page.journal[3].type.should.equal('remove')
        done()

  it 'should edit a paragraph in place', (done) ->
    body = JSON.stringify({
      type: 'edit'
      item: {id: 'a3', type: 'paragraph', text: 'edited'}
      id: 'a3'
    })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(200)
      .end (err, res) ->
        if err
          throw err
        try
          page = JSON.parse(fs.readFileSync(loc))
        catch err
          throw err
        page.story[1].text.should.equal('edited')
        page.journal[4].type.should.equal('edit')
        done()

  it 'should default to no change', (done) ->
    body = JSON.stringify({
      type: 'asdf'
      })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(500)
      .end (err, res) ->
        if err
          throw err
        try
          page = JSON.parse(fs.readFileSync(loc))
        catch err
          throw err
        page.story.length.should.equal(4)
        page.journal.length.should.equal(5)
        page.story[0].id.should.equal('a1')
        page.story[3].text.should.equal('this is the fourth paragraph')
        page.journal[4].type.should.equal('edit')
        done()

  it 'should refuse to create over a page', (done) ->
    body = JSON.stringify({
      type: 'create'
      item: { title: 'Doh'}
      id: 'c1'
    })

    request
      .put('/page/adsf-test-page/action')
      .send("action=" + body)
      .expect(409)
      .end (err, res) ->
        #console.log err
        #console.log res
        if err
          throw err
        try
          page = JSON.parse(fs.readFileSync(loc))
        catch err
          throw err
        page.title.should.not.equal('Doh')
        done()

  it 'site should now have one page', (done) ->
    request
      .get('/system/slugs.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .end (err, res) ->
        if err
          throw err
        res.body.length.should.equal[1]
        res.body[0].should.equal['adsf-test-page']
        done()



  after( ->
    app.close() if app.close)
