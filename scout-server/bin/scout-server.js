#!/usr/bin/env node

var server = require(__dirname + '/../');
server.listen(server.config.get('port'), server.config.get('hostname'), function(){
  console.log('scout-server: ' + server.config.get('listen'));
});
