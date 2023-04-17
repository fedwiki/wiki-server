module.exports = function( grunt ) {

  "use strict";

  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.loadNpmTasks('grunt-git-authors');

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    mochaTest: {
      test: {
        options: {
          reporter: 'spec',
          require: [
            'coffeescript/register',
            'should'
          ]
        },
        src: [
          'test/defaultargs.coffee',
          'test/page.coffee',
          'test/random.coffee',
          'test/server.coffee',
          'test/sitemap.coffee'
        ]
      }
    },

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
    },

    watch: {
      all: {
        files: ['lib/*.coffee', 'test/*.coffee'],
        tasks: ['mochaTest']
      }
    }
  });

  grunt.registerTask('default', ['mochaTest']);
  grunt.registerTask('check', ['retire']);

}
