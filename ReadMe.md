# Wiki

Wiki is [define the scope of the project in terms of end-user value, right here in the first sentence]. What is a federated wiki, and why does federation matter? [The concept of federation needs a clear, concise explanation. This is the secret sauce that makes SFW worth using. How does someone who's never heard of SFW come to understand it?].

Over the past two years, the [Smallest Federated Wiki](https://github.com/WardCunningham/Smallest-Federated-Wiki) project has explored the concept and implementation details of the federated wiki concept. This code has been extracted from that project, with the goal of releasing a polished, easy to deploy package. 


### Using Wiki

Learn [how to wiki](http://fed.wiki.org/view/how-to-wiki) by reading [fed.wiki.org](http://fed.wiki.org/view/welcome-visitors)

### Running your own Wiki

The quickest way to set up a wiki on your local machine is to install it globally with `npm`:

    $ npm install -g wiki
    $ wiki

You can also:
* [deploy Wiki to your own server](#)
* [deploy Wiki to a Nodejs host](#)



### Developing Wiki

Read the [developer guide](#), then get the code, build the client, and start the server:

    $ git clone https://github.com/WardCunningham/wiki.git
    $ cd wiki
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


### Roadmap


### Changelog


### License

You may use the Wiki under either the
[MIT License](https://github.com/WardCunningham/wiki/blob/master/mit-license.txt) or the
[GNU General Public License](https://github.com/WardCunningham/wiki/blob/master/gpl-license.txt) (GPL) Version 2.