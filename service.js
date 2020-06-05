console.log('Publish and advertise Service');


const bonjour = require('bonjour')();
 
// advertise an HTTP server on port 3000
bonjour.publish({ name: 'JompasServ-12345678', type: 'http', port: 3000 });
 
