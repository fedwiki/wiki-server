var redis = require('redis')
  , parseRedisUrl = require('parse-redis-url')(redis)
  , fsPage = require('./page')
  , synopsis = require('../node_modules/wiki-client/lib/synopsis')


module.exports = function (opts) {

  var options, port, host
    , database = opts.database
    , classicPageGet = fsPage(opts).get

  if (database.url) {
    options = parseRedisUrl.parse(database.url);
    port = options.port;
    host = options.host;
  } else {
    options = database.options;
    port = database.port;
    host = database.host;
  }

  var client = redis.createClient(port, host, options);

  if (options && options.database) { 
    client.select(options.database); 
  }


  function put (file, page, cb) {
    client.multi()
      .hset('pages', file, JSON.stringify(page))
      // if we want to "page" through pages in some order, 
      // we'll need to index with a sorted set
      // .zadd('index', file, file) 
      .exec(function (err, replies) {
        if (err) { return cb(err); }
        cb(null, replies);
      });
  }

  function get (file, cb) {
    client.hget('pages', file, function (err, reply) {
      if (err) { return cb(err); }
      
      if (reply === null) {
        return classicPageGet(file, cb);
      }

      try {
        cb(null, JSON.parse(reply));
      } catch (e) {
        cb(e);
      }

    });
  }

  function pages (cb) {
    client.hgetall('pages', function (err, results) {
      if (err) { return cb(err); }

      if (!results) { return cb(null, []); }

      var pages = Object.keys(results).map(function (key) {
        var page = JSON.parse(results[key]);
        return {
          slug: key,
          title: page.title,
          date: (page.journal && (page.journal.length > 0))
                ? page.journal.pop().date
                : '',
          synopsis: synopsis(page)
        };
      });

      cb(null, pages);
    })
  }

  return { put: put, get: get, pages:pages };

};