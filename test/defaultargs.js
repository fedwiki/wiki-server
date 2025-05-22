defaultargs = require '../lib/defaultargs'

describe 'defaultargs', ->
  describe '#defaultargs()', ->
    it 'should not write over give args', ->
      defaultargs({port: 1234}).port.should.equal(1234)
    it 'should write non give args', ->
      defaultargs().port.should.equal(3000)
    it 'should modify dependant args', ->
      defaultargs({data: '/tmp/asdf/'}).db.should.equal('/tmp/asdf/pages')	
