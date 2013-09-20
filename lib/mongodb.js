var mongodb  = require('mongoskin')
  , fsPage   = require('./page')
  , synopsis = require('../client/lib/synopsis');

module.exports = function (opts) {
  var config         = opts.database
    , url            = config.url || process.env.MONGO_URI || process.env.MONGOLAB_URI || process.env.MONGOHQ_URL
    , options        = config.options || {}
    , classicPageGet = fsPage(opts).get
    , db;

  if (!url) {
    throw new Error("The mongodb url is missing from database configuration")
  }

  db = mongodb.db(url, options)

  db.bind('pages')

  function put (file, page, cb) {
    page.slug = file;
    db.pages.save(page, {}, cb);
  }

  function get (file, cb) {
    db.pages.findOne({slug: file}, {}, function (err, page) {
      if (err) { return cb(err); }

      if (page === null) {
        return classicPageGet(file, cb);
      }

      cb(null, page);
    });
  }

  function pages (cb) {
    db.pages.findItems({}, function(err, rawPages) {
      var digests = rawPages.map(function (rawPage) {
        return {
          slug:     rawPage.slug,
          title:    rawPage.title,
          date:     rawPage.date,
          synopsis: synopsis(rawPage)
        };
      });

      cb(null, digests);
    });
  }

  return { put: put, get: get, pages:pages };
};