const gitAuthors = require('grunt-git-authors')

// list of contributers from prior the split out of Smallest Federated Wiki repo.
const priorAuthors = [
  'Ward Cunningham <ward@c2.com>',
  'Nick Niemeir <nick.niemeir@gmail.com>',
  'Patrick Mueller <pmuellr@apache.org>',
  'Erkan Yilmaz <erkan77@gmail.com>',
  'Tom Lee <github@tomlee.co>',
  'Nicholas Hallahan <nick@theoutpost.io>',
  'Paul Rodwell <paul.rodwell@btinternet.com>',
  'Austin King <shout@ozten.com>',
]

gitAuthors.updatePackageJson({ priorAuthors: priorAuthors, order: 'date' }, error => {
  if (error) {
    console.log('Error: ', error)
  }
})

gitAuthors.updateAuthors(
  {
    priorAuthors: priorAuthors.reverse(),
  },
  (error, filename) => {
    if (error) {
      console.log('Error: ', error)
    } else {
      console.log(filename, 'updated')
    }
  },
)
