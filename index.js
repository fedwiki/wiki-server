// **index.js**
// Simple file so that if you require this directory
// in node it instead requires ./lib/server.coffee
// with coffee-script already loaded.
require('coffee-script');
require('coffee-script/register');

// set a default process exitCode, so we can diferentiate between exiting as
// part of a reload, and an exit after an uncaught error
process.exitCode = 1

module.exports = require('./lib/server');
