module.exports = function( grunt ) {

  "use strict";

  grunt.loadNpmTasks('grunt-git-authors');

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

}
