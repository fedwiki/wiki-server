const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const random = require('../lib/random_id')

describe('random', () => {
  describe('#random_id', () => {
    it('should not be the same twice', () => {
      assert.notEqual(random(), random())
    })
    it('should be 16 digits', () => {
      assert.equal(random().length, 16)
    })
  })
})
