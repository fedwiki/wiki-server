const should = require('should')
const path = require('node:path')
const random = require('../lib/random_id')
const testid = random()
const argv = require('../lib/defaultargs')({
  data: path.join('/tmp', 'sfwtests', testid),
  root: path.join(__dirname, '..'),
  packageDir: path.join(__dirname, '..', 'node_modules'),
  security_legacy: true,
})
const page = require('../lib/page')(argv)
const fs = require('node:fs')

const testpage = { title: 'Asdf' }

console.log('testid', testid)

describe('page', () => {
  describe('#page.put()', () => {
    it('should save a page', done => {
      page.put('asdf', testpage, e => {
        done(e)
      })
    })
  })
  describe('#page.get()', () => {
    it('should get a page if it exists', done => {
      page.get('asdf', (e, got) => {
        if (e) throw e
        got.title.should.equal('Asdf')
        done()
      })
    })
    it('should copy a page from default if nonexistant in db', done => {
      page.get('welcome-visitors', (e, got) => {
        if (e) throw e
        got.title.should.equal('Welcome Visitors')
        done()
      })
    })
    // note: here we assume the wiki-plugin-activity repo has been cloned into an adjacent directory
    it('should copy a page from plugins if nonexistant in db', done => {
      page.get('recent-changes', (e, got) => {
        if (e) throw e
        got.title.should.equal('Recent Changes')
        done()
      })
    })
    // note: here we assume the wiki-plugin-activity repo has been cloned into an adjacent directory
    it('should mark a page from plugins with the plugin name', done => {
      page.get('recent-changes', (e, got) => {
        if (e) throw e
        got.plugin.should.equal('activity')
        done()
      })
    })
    it('should create a page if it exists nowhere', done => {
      page.get(random(), (e, got) => {
        if (e) throw e
        got.should.equal('Page not found')
        done()
      })
    })
    it('should eventually write the page to disk', done => {
      const test = () => {
        console.log('should write', argv)
        fs.readFile(path.join(argv.db, 'asdf'), (err, data) => {
          if (err) throw err
          const readPage = JSON.parse(data)
          page.get('asdf', (e, got) => {
            readPage.title.should.equal(got.title)
            done()
          })
        })
      }
      if (page.isWorking()) {
        page.on('finished', () => test())
      } else {
        test()
      }
    })
  })
})
