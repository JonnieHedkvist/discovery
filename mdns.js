
var mdns = require('mdns-server')({
  reuseAddr: true, // in case other mdns service is running
  loopback: false,  // receive our own mdns messages
  noInit: true     // do not initialize on creation
})

const G3ServiceType = 'tobii-g3api';

class MdnsServer {
    startedBrowsingTime;
    mdnsServerInstance;

    start = () => {
        console.log('Starting DNS Discovery....');
    
        // listen for response events from server
        mdns.on('response', function(response) {
          // console.log('mDNS --> got a response packet');
          let a = []
          if (response.answers) {
            a = a.concat(response.answers)
          }
          //Filter on Glasses 3
          a.filter((answer) => answer.name.includes(G3ServiceType)).forEach((answer) => {
            console.log('Got a Response packet:');
            console.log(`Name: ${answer.name}, type: ${answer.type}, data: ${answer.data}`);
          })
        });
    
        // listen for query events from server
        mdns.on('query', function(query) {
          // console.log('got a query packet:');
          let q = [];
          if (query.questions) {
            q = q.concat(query.questions);
          }
          // console.log(q);
        });
    
        // listen for the server being destroyed
        mdns.on('destroyed', function() {
          console.log('Server destroyed.');
          process.exit(0);
        });
    
        // query for all services on networks
        mdns.on('ready', () => {
          mdns.query({
            questions: [{
              name: '_tobii-g3api._tcp.local',
              // name: G3ServiceType,
              type: 'PTR'
            }]
          });
          
        });
    
        mdns.initServer();
    }

}

let discovery = new MdnsServer();
discovery.start();