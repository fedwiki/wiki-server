# Wiki

Wiki is a single-page application for browsing and editing content distributed throughout a federation of similar creative-commons licensed sites. What is a federated wiki, and why does federation matter? Authors thoughout the federation pull content towards themselves as they edit. With this package authors publish their own edits back to the federation as they edit.

Over the past two years, the [Smallest Federated Wiki](https://github.com/WardCunningham/Smallest-Federated-Wiki) project has explored the concept and implementation details of the federated wiki concept. This code has been extracted from that project, with the goal of releasing a polished, easy to deploy package. 


### Using Federated Wiki

Learn [how to wiki](http://fed.wiki.org/view/how-to-wiki) by reading [fed.wiki.org](http://fed.wiki.org/view/welcome-visitors)

### Running your own Server

The quickest way to set up wiki on your local machine is to install it globally with `npm`:

    $ npm install -g wiki
    $ wiki

Visit localhost:3000 to see your wiki. If you choose a host visible to the internet then other in the federation can use your work.

### Server Options

Options for the server can be passed in many ways:

* As command line flags
* As a configuration JSON file specified with --config
* As a config.json file in the root folder or cwd.
* As env vars prefixed with `wiki_`

Higher in the list takes precedence.
The server will then try to guess all unspecified options.

#### Datastore options

A number of datastores are supported. Use the --database and --data options to configure, or use the config.json.

##### flatfiles (default)

The default path to store page data is in a "default-data" subdirectory of the install directory. You can override this like so:

    $ wiki --data FILESYSTEM_PATH

##### mongodb

The mongodb connection arguments are specified as follows:

    $ wiki --database '{"type": "./mongodb", "url": "...", "options": {...}}'

For convenience the url will also be read from MONGO_URI, MONGOLAB_URI, or MONGOHQ_URL. This smooths the Heroku deployment process somewhat.

The mongodb datastore allows for a graceful upgrade path. If a page is not found in redis the flatfile datastore will be consulted.

##### redis

The Redis connection arguments are specified as follows:

    $ wiki --database '{"type": "./redis", "host": "...", "port": nnn, "options": {...}}'

The Redis datastore allows for a graceful upgrade path. If a page is not found in redis the flatfile datastore will be consulted.

##### leveldb

The leveldb datastore uses JSON encoded leveldb format and is configured by providing a filesystem path:

    $ wiki --database '{"type": "./leveldb"}' --data FILESYSTEM_PATH

The leveldb datastore allows for a graceful upgrade path. If a page is not found in redis the flatfile datastore will be consulted.

### Developing Wiki

This package consists of client and server code as well as a number of sample plugins that create special purpose markups that can be used on a paragraph by paragraph basis. Get the code, build the client, and start the server:

    $ git clone https://github.com/WardCunningham/wiki.git
    $ cd wiki
    $ npm install
    $ grunt build
    $ npm start

While you're coding, you can also watch for files to change. This will rebuild the client each time you save a file.

    $ grunt watch

Test the server-side code by running `$ grunt test`. 

Test the client-side code by starting your wiki server with `$npm start` and opening [`http://localhost:3000/runtests.html`](http://localhost:3000/runtests.html)



### How to Participate

* Join the developer IRC channel, `#fedwiki` on freenode
* Stop by the [Google Hangout](http://bit.ly/SFWhangout) at 10am Pacific every Wednesday
* Submit [Issues](https://github.com/WardCunningham/wiki/issues) 
* Fork, commit and submit [Pull Requests](https://github.com/WardCunningham/wiki/pulls)


### License

You may use the Wiki under either the
[MIT License](https://github.com/WardCunningham/wiki/blob/master/mit-license.txt) or the
[GNU General Public License](https://github.com/WardCunningham/wiki/blob/master/gpl-license.txt) (GPL) Version 2.
