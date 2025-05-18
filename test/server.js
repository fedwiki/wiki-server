const supertest = require('supertest')
const fs = require('node:fs')
const server = require('..')
const path = require('node:path')
const random = require('../lib/random_id')
const testid = random()
const argv = require('../lib/defaultargs.coffee')({
  data: path.join('/tmp', 'sfwtests', testid),
  packageDir: path.join(__dirname, '..', 'node_modules'),
  port: 55557,
  security_legacy: true,
})

describe('server', () => {
  var app = {}
  before(done => {
    // as starting the server this was does not create a sitemap file, create an empty one
    const sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid))
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid, 'status'))
    fs.writeFileSync(sitemapLoc, JSON.stringify([]))

    app = server(argv)
    app.once('owner-set', () => {
      app.listen(app.startOpts.port, app.startOpts.host, done)
    })
  })

  const request = supertest('http://localhost:55557')

  // location of the test page
  const loc = path.join('/tmp', 'sfwtests', testid, 'pages', 'adsf-test-page')

  it('factories should return a list of plugin', () => {
    request
      .get('/system/factories.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(res => {
        res.body[1].name.should.equal('Video')
        res.body[1].category.should.equal('format')
      })
  })

  it('new site should have an empty list of pages', () => {
    request
      .get('/system/slugs.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(
        res => res.body.should.be.empty,
        error => {
          throw error
        },
      )
      .catch(error => {
        throw error
      })
  })

  it('should create a page', () => {
    const body = JSON.stringify({
      type: 'create',
      item: {
        title: 'Asdf Test Page',
        story: [
          { id: 'a1', type: 'paragraph', text: 'this is the first paragraph' },
          { id: 'a2', type: 'paragraph', text: 'this is the second paragraph' },
          { id: 'a3', type: 'paragraph', text: 'this is the third paragraph' },
          { id: 'a4', type: 'paragraph', text: 'this is the fourth paragraph' },
        ],
      },
      date: 1234567890123,
    })

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .catch(err => {
        throw err
      })
  })

  it('should move the paragraphs to the order given ', () => {
    const body = '{ "type": "move", "order": [ "a1", "a3", "a2", "a4"] }'

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          page.story[1].id.should.equal('a3')
          page.story[2].id.should.equal('a2')
          page.journal[1].type.should.equal('move')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('should add a paragraph', () => {
    const body = JSON.stringify({
      type: 'add',
      after: 'a2',
      item: { id: 'a5', type: 'paragraph', text: 'this is the NEW paragrpah' },
    })

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          page.story.length.should.equal(5)
          page.story[3].id.should.equal('a5')
          page.journal[2].type.should.equal('add')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('should remove a paragraph with given id', () => {
    const body = JSON.stringify({
      type: 'remove',
      id: 'a2',
    })

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          page.story.length.should.equal(4)
          page.story[1].id.should.equal('a3')
          page.story[2].id.should.not.equal('a2')
          page.story[2].id.should.equal('a5')
          page.journal[3].type.should.equal('remove')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('should edit a paragraph in place', () => {
    const body = JSON.stringify({
      type: 'edit',
      item: { id: 'a3', type: 'paragraph', text: 'edited' },
      id: 'a3',
    })

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          page.story[1].text.should.equal('edited')
          page.journal[4].type.should.equal('edit')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('should default to no change', () => {
    const body = JSON.stringify({
      type: 'asdf',
    })

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(500)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          page.story.length.should.equal(4)
          page.journal.length.should.equal(5)
          page.story[0].id.should.equal('a1')
          page.story[3].text.should.equal('this is the fourth paragraph')
          page.journal[4].type.should.equal('edit')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('should refuse to create over a page', () => {
    const body = JSON.stringify({
      type: 'create',
      item: { title: 'Doh' },
      id: 'c1',
    })

    request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(409)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          page.title.should.not.equal('Doh')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('site should now have one page', () => {
    request
      .get('/system/slugs.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(
        res => {
          res.body.length.should.equal[1]
          res.body[0].should.equal['adsf-test-page']
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  after(() => {
    if (app.close) app.close()
  })
})
