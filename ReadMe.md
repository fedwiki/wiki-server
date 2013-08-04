Federated Wiki
==============

This wiki has been extracted from the two year old
GitHub project [Smallest-Federated-Wiki](https://github.com/WardCunningham/Smallest-Federated-Wiki).

Our goal in this fork is two fold.

1. Publish the server as an npm package
2. Factor the code into smaller, tested npm packages

How to Install and Launch
=========================

To install and launch on localhost:3000

	npm install -g wiki
	wiki

To launch with on port 8080 with pages in /tmp/wiki8080

	wiki -p 8080 -d /tmp/wiki8080

To build from source and launch on localhost:3000

	git clone https://github.com/WardCunningham/wiki
	cd wiki
	npm install
	grunt build
	npm start


How to Participate
==================

First you will want to get caught up with some project history. We've been recording screencast videos for as long as we've had something to demo. You should watch them all. They're short:

* http://wardcunningham.github.com

Then you may want to read through the end-user how-to documentation which is itself written in a federated wiki:

* http://fed.wiki.org/how-to-wiki.html

Code contributions are always welcome. We're developing using the `fork and pull request` model supported so well by GitHub. Please read through their excellent help to make sure you know what's expected of you:

* http://help.github.com/send-pull-requests/

You are welcome to join our developer IRC channel, #fedwiki on freenode. We also meet for a google video chat every Wednesday morning at 10am Pacific time.

* http://bit.ly/SFWhangout

We're proud to be forked frequently. Go ahead and fork this project now. We're glad to have you.

License
=======

You may use the Smallest Federated Wiki under either the
[MIT License](https://github.com/WardCunningham/Smallest-Federated-Wiki/blob/master/mit-license.txt) or the
[GNU General Public License](https://github.com/WardCunningham/Smallest-Federated-Wiki/blob/master/gpl-license.txt) (GPL) Version 2.

