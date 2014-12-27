var zookeeper = require('node-zookeeper-client'),
    influx    = require('influx'),
    io        = require('socket.io-client');

var collector = function(){

  this.constants = {
    BASE_ZNODE_PATH : '/xpush',
    SERVERS_PATH    : '/servers',
    META_PATH       : '/meta',
    APP_PATH        : '/app',
    GW_SERVER_PATH  : '/session' }

  this.servers = [];

  this.ios = {};
  this.checks = {};
  this.infos = {};


};

collector.prototype.start = function(config){

  var self = this;

  self.dbInflux = influx({
    host :     config.influxdb.host,
    port :     config.influxdb.port,
    username : config.influxdb.username,
    password : config.influxdb.password,
    database : config.influxdb.database
  });

  self.collect(config);

  var address = config.zookeeper.address || 'localhost:2181';

  var zkClient = zookeeper.createClient(address);

  zkClient.connect();

  zkClient.getChildren(self.constants.BASE_ZNODE_PATH + self.constants.SERVERS_PATH, function(error, nodes, stats) {

    if (error) {
      console.error('Error watching zookeeper nodes: ', error);
      process.exit(1);
    }

    self.servers = [];
    for (var i = 0; i < nodes.length; i++) {

      var ninfo = nodes[i].split('^');

      if ( !self.ios[ninfo[1]] ) {

        var query = '1=1';
        if(config.token) query = 'token='+config.token;

        self.ios[ninfo[1]] = io.connect(
          'http://'+ninfo[1]+'/admin?'+query,
          { transsessionPorts: ['websocket'] ,'force new connection': true }
        );

        self.ios[ninfo[1]].on( 'connect', function (){

          console.log(' >>>>>>>>>>>>>> ', 'asdf');

          self.checks[ninfo[1]] = false;

          self.ios[ninfo[1]].emit('usage', function(data){
            self.infos[ninfo[1]] = data;
          });

        });

        self.ios[ninfo[1]].on( 'error', function (err){
          console.error('err : ', err);
        });
      }

      self.servers.push({
        id  : ninfo[0],
        /*host: ninfo[1].substr(0, ninfo[1].indexOf(':')),
        port: Number(ninfo[1].substr(ninfo[1].indexOf(':') + 1)),*/
        url : ninfo[1],
        repl: ninfo[2]
      });

      console.log('>>>>', 'http://'+ninfo[1]+'/admin?'+query);

    }

  });
};

collector.prototype.collect = function(config){

  var self = this;

  var interval = 2000 || config.interval;

  setInterval(function() {

    var arrayLength = self.servers.length;

    for (var i = 0; i < arrayLength; i++) {

      if(self.ios[self.servers[i].url]){

        var _servers = self.servers[i];

        console.log(' ------- '+self.servers[i].url);

        self.ios[self.servers[i].url].emit('usage', function(data){

          var tname = 'channel.memory.'+ _servers.id ;
          console.log(' >>> ',tname, data);
          self.dbInflux.writePoint(tname , { time: new Date(), value: JSON.stringify(data.process.memory) }, function(err) {
            if(err) throw err;
          });

        });
      }

    }

  }, interval);

};

module.exports = new collector();
