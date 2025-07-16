// **index.js**
// Simple file so that if you require this directory
// in node it instead requires ./lib/server.coffee
// with coffee-script already loaded.
require('coffeescript')
require('coffeescript/register')

module.exports = require('./lib/server')
