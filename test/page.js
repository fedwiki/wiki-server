const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

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
    it('should save a page', () => {
      page.put('asdf', testpage, e => {
        if (e) throw e
      })
    })
  })
  describe('#page.get()', () => {
    it('should get a page if it exists', () => {
      page.get('asdf', (e, got) => {
        if (e) throw e
        assert.equal(got.title, 'Asdf')
      })
    })
    it('should copy a page from default if nonexistant in db', () => {
      page.get('welcome-visitors', (e, got) => {
        if (e) throw e
        assert.equal(got.title, 'Welcome Visitors')
      })
    })
    // note: here we assume the wiki-plugin-activity repo has been cloned into an adjacent directory
    it('should copy a page from plugins if nonexistant in db', () => {
      page.get('recent-changes', (e, got) => {
        if (e) throw e
        assert.equal(got.title, 'Recent Changes')
      })
    })
    // note: here we assume the wiki-plugin-activity repo has been cloned into an adjacent directory
    it('should mark a page from plugins with the plugin name', () => {
      page.get('recent-changes', (e, got) => {
        if (e) throw e
        assert.equal(got.plugin, 'activity')
      })
    })
    it('should create a page if it exists nowhere', () => {
      page.get(random(), (e, got) => {
        if (e) throw e
        assert.equal(got, 'Page not found')
      })
    })
    it.skip('should eventually write the page to disk', async () => {
      const test = () => {
        console.log('should write', argv)
        fs.readFile(path.join(argv.db, 'asdf'), (err, data) => {
          if (err) throw err
          const readPage = JSON.parse(data)
          page.get('asdf', (e, got) => {
            assert.equal(readPage.title, got.title)
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
