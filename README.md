# HTTP SOCKS5 support for node.js

  __WARNING__: work in progress (for now only SOCKS5 is supported)

## Install

    $ npm install socksified

## TODO

  - SOCKS4 support
  - HTTPS support

## Example

```js
var http = require('http');
var SocksAgent = require('socksified').SocksAgent;

var socksAgent = new SocksAgent({socks_host: '127.0.0.1', socks_port: 1080});

var options = {
    agent: socksAgent,
    host: 'www.google.com',
    port: 80,
    path: '/'
};

http.get(options, function(res) {
    console.log("Got response: " + res.statusCode);
}).on('error', function(e) {
    console.log("Got error: " + e.message);
});
```
