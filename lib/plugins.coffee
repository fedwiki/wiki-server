###
 * Federated Wiki : Node Server
 *
 * Copyright Ward Cunningham and other contributors
 * Licensed under the MIT license.
 * https://github.com/fedwiki/wiki-server/blob/master/LICENSE.txt
###

# support server-side plugins

fs = require 'fs'
path = require 'path'
glob = require 'glob'
events = require 'events'
# forward = require './forward'

module.exports = exports = (argv) ->

# NOTE: plugins are now in their own package directories alongside this one...
# Plugins are in directories of the form wiki-package-*
# those with a server component will have a server directory

	plugins = {}

	# http://stackoverflow.com/questions/10914751/loading-node-js-modules-dynamically-based-on-route

	startServer = (params, plugin) ->
		server = "#{argv.packageDir}/#{plugin}/server/server.js"
		fs.exists server, (exists) ->
			if exists
				console.log 'starting plugin', plugin
				try
					plugins[plugin] = require server
					plugins[plugin].startServer?(params)
				catch e
					console.log 'failed to start plugin', plugin, e?.stack or e

	startServers = (params) ->
		# emitter = new events.EventEmitter()
		# forward.init params.app, emitter
		# params.emitter = emitter
		glob "wiki-plugin-*", {cwd: argv.packageDir}, (e, plugins) ->
			startServer params, plugin for plugin in plugins


	{startServers}
