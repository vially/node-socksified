var http = require('http')
//var SocksAgent = require('socksified').SocksAgent;
var SocksAgent = require('./index').SocksAgent;

var socksAgent = new SocksAgent({socks_host: '127.0.0.1', socks_port: 1080});

var options = {
  agent: socksAgent,
  host: 'api.externalip.net',
  port: 80,
  path: '/ip/'
};

http.get(options, function(res) {
  res.on('data', function(data) {
    console.log('Public IP Address: %s', data);
  });
}).on('error', function(e) {
  console.log("Got error: " + e.message);
});
