var net = require('net');
var http = require('http');
var stream = require('stream');
var inherits = require('util').inherits;
var ipv6 = require('ipv6').v6;
var sprintf = require('sprintf').sprintf;

// HTTPS agents.
var agents = {};

var getDirectConnection = http.Agent.prototype._getConnection;

function Agent(options) {
  http.Agent.call(this, options);
}
inherits(Agent, http.Agent);

function initializeSocksSocket(socks_host, socks_port, host, port, cb) {
  var socket = new SocksSocket();

  socket.connect(socks_port, socks_host);

  socket.on('connect', function() {
    socket._authenticate(function() {
      socket._connect(host, port, cb);
    });
  });

  return socket;
}

Agent.prototype._getConnection = function(agent, cb) {
  var options = agent.options;
  if (!options.socks_host || !options.host) {
    return getDirectConnection(options, cb);
  }

  var socksHost = options.socks_host;
  var socksPort = options.socks_port || 1080;

  var socket = initializeSocksSocket(socksHost, socksPort, options.host, options.port, cb);

  return socket;
};

function getAgent(options) {
  if (!options.port) options.port = 80;

  var id = options.host + ':' + options.port;
  var agent = agents[id];

  if (!agent) {
    agent = agents[id] = new Agent(options);
  }

  return agent;
}

exports.Agent = Agent;

exports.request = function(options, cb) {
  if (options.agent === undefined) {
    options.agent = getAgent(options);
  } else if (options.agent === false) {
    options.agent = new Agent(options);
  }
  return http._requestFromAgent(options, cb);
};


exports.get = function(options, cb) {
  options.method = 'GET';
  var req = exports.request(options, cb);
  req.end();
  return req;
};

function SocksSocket() {
  net.Socket.call(this);
}
inherits(SocksSocket, net.Socket);

SocksSocket.prototype._write = net.Socket.prototype.write;
SocksSocket.prototype.write = function(data /* [encoding], [fd], [cb] */) {
  var encoding, fd, cb;

  // parse arguments
  if (typeof arguments[1] == 'string') {
    encoding = arguments[1];
    if (typeof arguments[2] == 'number') {
      fd = arguments[2];
      cb = arguments[3];
    } else {
      cb = arguments[2];
    }
  } else if (typeof arguments[1] == 'number') {
    fd = arguments[1];
    cb = arguments[2];
  } else if (typeof arguments[2] == 'number') {
    // This case is to support old calls when the encoding argument
    // was not optional: s.write(buf, undefined, pipeFDs[1])
    encoding = arguments[1];
    fd = arguments[2];
    cb = arguments[3];
  } else {
    cb = arguments[1];
  }

  if (this._writeQueueLast() === 42) {
    throw new Error('Socket.end() called already; cannot write.');
  }

  if (!this._pendingWriteQueue) {
    this._pendingWriteQueue = [];
    this._pendingWriteQueueEncoding = [];
    this._pendingWriteQueueFD = [];
    this._pendingWriteQueueCallbacks = [];
  }

  this._pendingWriteQueue.push(data);
  this._pendingWriteQueueEncoding.push(encoding);
  this._pendingWriteQueueFD.push(fd);
  this._pendingWriteQueueCallbacks.push(cb);

  return false;
}

SocksSocket.prototype._writePendingData = function() {
  for(var i=0; i < this._pendingWriteQueue.length; i++) {
    var data = this._pendingWriteQueue.shift();
    var encoding = this._pendingWriteQueueEncoding.shift();
    var fd = this._pendingWriteQueueFD.shift();
    var cb = this._pendingWriteQueueCallbacks.shift();
    net.Socket.prototype.write.call(this, data, encoding, fd, cb);
  }
}

SocksSocket.prototype._authenticate = function(cb) {
  if(this.ondata) this._ondata = this.ondata;
  this.ondata = function(d, start, end) {
    if(end - start != 2) {
      throw new Error('SOCKS authentication failed. Unexpected number of bytes received');
    }

    if(d[start] != 0x05) {
      throw new Error('SOCKS authentication failed. Unexpected SOCKS version number: ' + d[start]);
    }

    if(d[start + 1] != 0x00) {
      throw new Error('SOCKS authentication failed. Unexpected SOCKS authentication method: ' + d[start+1]);
    }

    //if(this._ondata) this.ondata = this._ondata;
    this.ondata = this._ondata;
    if(cb) cb();
  }

  var request = new Buffer(3);
  request[0] = 0x05;  // SOCKS version
  request[1] = 0x01;  // number of authentication methods
  request[2] = 0x00;  // no authentication
  net.Socket.prototype.write.call(this, request);
}

SocksSocket.prototype._connect = function(host, port, cb) {
  if(this.ondata) this._ondata = this.ondata;
  this.ondata = function(d, start, end) {
    if(d[start] != 0x05) {
      throw new Error('SOCKS connection failed. Unexpected SOCKS version number: ' + d[start]);
    }

    if(d[start+1] != 0x00) {
      var msg = get_error_message(d[start+1]);
      throw new Error('SOCKS connection failed. ' + msg);
    }

    if(d[start+2] != 0x00) {
      throw new Error('SOCKS connection failed. The reserved byte must be 0x00');
    }

    var address = '';
    var address_length = 0;

    switch(d[start+3]) {
      case 1:
        address = d[start+4] + '.' + d[start+5] + '.' + d[start+6] + '.' + d[start+7];
        address_length = 4;
        break;
      case 3:
        address_length = d[start+4] + 1;
        for(var i = start + 5; i < start + address_length; i++) {
          address += String.fromCharCode(d[i]);
        }
        break;
      case 4:
        address_length = 16;
        break;
      default:
        throw new Error('SOCKS connection failed. Unknown addres type: ' + d[start+3]);
    }

    var portIndex = start + 4 + address_length;
    var port = d[portIndex] * 256 + d[portIndex+1];

    var boundAddress = {
      'address':  address,
      'port':     port
    };
    //console.log('Bound Address: %j', boundAddress);

    this._writePendingData();
    this.write = this._write;
    this._write = null;

    //if(this._ondata) this.ondata = this._ondata;
    this.ondata = this._ondata;
    if(cb) cb();
  }

  var buffer = [];
  buffer.push(0x05);  // SOCKS version 
  buffer.push(0x01);  // command code: establish a TCP/IP stream connection
  buffer.push(0x00);  // reserved - myst be 0x00

  switch(net.isIP(host)) {
    case 0:
      buffer.push(0x03);
      parseDomainName(host, buffer);
      break;
    case 4:
      buffer.push(0x01);
      parseIPv4(host, buffer);
      break;
    case 6:
      buffer.push(0x04);
      parseIPv6(host, buffer);
      break;
  }

  parsePort(port, buffer);

  var request = new Buffer(buffer);
  this._write(request);
}

function parseIPv4(host, buffer) {
  var groups = host.split('.');
  for(var i=0; i < groups.length; i++) {
    var ip = parseInt(groups[i]);
    buffer.push(ip);
  }
}

function parseIPv6(host, buffer) {
  var address = new ipv6.Address(host).canonical_form();
  var groups = address.split(':');
  for(var i=0; i < groups.length; i++) {
    var part1 = groups[i].substr(0,2);
    var part2 = groups[i].substr(2,2);

    var b1 = parseInt(part1, 16);
    var b2 = parseInt(part2, 16);

    buffer.push(b1);
    buffer.push(b2);
  }
}

function parseDomainName(host, buffer) {
  buffer.push(host.length);
  for(var i=0; i < host.length; i++) {
    var c = host.charCodeAt(i);
    buffer.push(c);
  }
}

function parsePort(port, buffer) {
  var portStr = sprintf("%04d", port);
  var byte1 = parseInt(portStr.substr(0,2));
  var byte2 = parseInt(portStr.substr(2,2));

  buffer.push(byte1);
  buffer.push(byte2);
}

function get_error_message(code) {
  switch(code) {
    case 1:
      return 'General SOCKS server failure';
    case 2:
      return 'Connection not allowed by ruleset';
    case 3:
      return 'Network unreachable';
    case 4:
      return 'Host unreachable';
    case 5:
      return 'Connection refused';
    case 6:
      return 'TTL expired';
    case 7:
      return 'Command not supported';
    case 8:
      return 'Address type not supported';
    default:
      return 'Unknown status code ' + code;
  }
}
