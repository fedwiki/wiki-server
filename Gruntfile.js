module.exports = function( grunt ) {

  "use strict";

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    authors: {
      prior: [
        "Ward Cunningham <ward@c2.com>",
        "Nick Niemeir <nick.niemeir@gmail.com>",
        "Patrick Mueller <pmuellr@apache.org>",
        "Erkan Yilmaz <erkan77@gmail.com>",
        "Tom Lee <github@tomlee.co>",
        "Nicholas Hallahan <nick@theoutpost.io>",
        "Paul Rodwell <paul.rodwell@btinternet.com>",
        "Austin King <shout@ozten.com>"
      ]
    }
  });

  grunt.registerTask( "update-authors", function () {
  var getAuthors = require("grunt-git-authors"),
  done = this.async();

  getAuthors({
    priorAuthors: grunt.config( "authors.prior")
  }, function(error, authors) {
    if (error) {
      grunt.log.error(error);
      return done(false);
    }

    authors = authors.map(function(author) {
      if (author.match( /^Peter deHaan </) ) {
        return "Peter deHaan (http://about.me/peterdehaan)";
      } else {
        return author;
      }
    });

    grunt.file.write("AUTHORS.txt",
    "Authors ordered by first contribution\n\n" +
    authors.join("\n") + "\n");
  });
});


}
