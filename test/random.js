const random = require('../lib/random_id')
const should = require('should')

describe('random', () => {
  describe('#random_id', () => {
    it('should not be the same twice', () => {
      random().should.not.equal(random())
    })
    it('should be 16 digits', () => {
      random().length.should.equal(16)
    })
  })
})
