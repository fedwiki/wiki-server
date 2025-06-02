const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const supertest = require('supertest')
const fs = require('node:fs')
const server = require('..')
const path = require('node:path')
const random = require('../lib/random_id')
const testid = random()
const argv = require('../lib/defaultargs')({
  data: path.join('/tmp', 'sfwtests', testid),
  packageDir: path.join(__dirname, '..', 'node_modules'),
  port: 55557,
  security_legacy: true,
  test: true,
})

describe('server', d => {
  var app = {}
  let runningServer = null
  before(done => {
    // as starting the server this was does not create a sitemap file, create an empty one
    const sitemapLoc = path.join('/tmp', 'sfwtests', testid, 'status', 'sitemap.json')
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid))
    fs.mkdirSync(path.join('/tmp', 'sfwtests', testid, 'status'))
    fs.writeFileSync(sitemapLoc, JSON.stringify([]))

    app = server(argv)
    app.once('owner-set', () => {
      runningServer = app.listen(app.startOpts.port, app.startOpts.host, done)
    })
  })

  after(() => {
    runningServer.close()
  })

  const request = supertest('http://localhost:55557')

  // location of the test page
  const loc = path.join('/tmp', 'sfwtests', testid, 'pages', 'adsf-test-page')

  it('factories should return a list of plugin', async () => {
    await request
      .get('/system/factories.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(res => {
        assert.equal(res.body[1].name, 'Video')
        assert.equal(res.body[1].category, 'format')
      })
  })

  it('new site should have an empty list of pages', async () => {
    await request
      .get('/system/slugs.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(res => assert.deepEqual(res.body, []))
  })

  it('should create a page', async () => {
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

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
  })

  it('should move the paragraphs to the order given ', async () => {
    const body = '{ "type": "move", "order": [ "a1", "a3", "a2", "a4"] }'

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(
        () => {
          const page = JSON.parse(fs.readFileSync(loc))
          assert(page.story[1].id, 'a3')
          assert(page.story[2].id, 'a2')
          assert(page.journal[1].type, 'move')
        },
        err => {
          throw err
        },
      )
      .catch(err => {
        throw err
      })
  })

  it('should add a paragraph', async () => {
    const body = JSON.stringify({
      type: 'add',
      after: 'a2',
      item: { id: 'a5', type: 'paragraph', text: 'this is the NEW paragrpah' },
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(() => {
        const page = JSON.parse(fs.readFileSync(loc))
        assert.equal(page.story.length, 5)
        assert.equal(page.story[3].id, 'a5')
        assert.equal(page.journal[2].type, 'add')
      })
      .catch(err => {
        throw err
      })
  })

  it('should remove a paragraph with given id', async () => {
    const body = JSON.stringify({
      type: 'remove',
      id: 'a2',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(() => {
        const page = JSON.parse(fs.readFileSync(loc))
        assert(page.story.length == 4)
        assert.equal(page.story[1].id, 'a3')
        assert.notEqual(page.story[2].id, 'a2')
        assert.equal(page.story[2].id, 'a5')
        assert.equal(page.journal[3].type, 'remove')
      })
      .catch(err => {
        throw err
      })
  })

  it('should edit a paragraph in place', async () => {
    const body = JSON.stringify({
      type: 'edit',
      item: { id: 'a3', type: 'paragraph', text: 'edited' },
      id: 'a3',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(200)
      .then(() => {
        const page = JSON.parse(fs.readFileSync(loc))
        assert.equal(page.story[1].text, 'edited')
        assert.equal(page.journal[4].type, 'edit')
      })
      .catch(err => {
        throw err
      })
  })

  it('should default to no change', async () => {
    const body = JSON.stringify({
      type: 'asdf',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(500)
      .then(() => {
        const page = JSON.parse(fs.readFileSync(loc))
        assert(page.story.length == 4)
        assert(page.journal.length == 5)
        assert.equal(page.story[0].id, 'a1')
        assert.equal(page.story[3].text, 'this is the fourth paragraph')
        assert.equal(page.journal[4].type, 'edit')
      })
      .catch(err => {
        throw err
      })
  })

  it('should refuse to create over a page', async () => {
    const body = JSON.stringify({
      type: 'create',
      item: { title: 'Doh' },
      id: 'c1',
    })

    await request
      .put('/page/adsf-test-page/action')
      .send('action=' + body)
      .expect(409)
      .then(() => {
        const page = JSON.parse(fs.readFileSync(loc))
        assert.notEqual(page.title, 'Doh')
      })
      .catch(err => {
        throw err
      })
  })

  it('site should now have one page', async () => {
    await request
      .get('/system/slugs.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then(res => {
        assert(res.body.length == 1)
        assert.equal(res.body[0], 'adsf-test-page')
      })
      .catch(err => {
        throw err
      })
  })
})
