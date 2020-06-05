const bonjour = require('bonjour');
const {performance} = require('perf_hooks');

const G3ServiceType = 'tobii-g3api';
let browsInterval;

class BonjourDiscoveryServer {
    startedBrowsingTime;
    bonjourBrowser;

    start = () => {
        console.log('Starting Discovery Service....');

        this._setupBonjour();
        browsInterval = setInterval(() => {
            this._teardownBonjour();
            this._setupBonjour();
        }, 10000);
    }

    _setupBonjour = () => {
        console.log('Starting Bonjour Browser');
        this.startedBrowsingTime = performance.now();

        let bonjourInstance = bonjour();
        this.bonjourBrowser = bonjourInstance.find(
          {
            type: G3ServiceType
          },
          (service) => {
            console.log(`Bonjour -- Found Service after ${Math.floor(performance.now() - this.startedBrowsingTime)} ms`, service);
          });
        this.bonjourBrowser.on('down', (service) => {
          console.log('Bonjour -- LOST Service:', service);
        });
        this.bonjourBrowser.on('error', (err) => {
          console.error('Error in Bonjour Discovery::', err);
        });
      }
    
      _teardownBonjour = () => {
        if (!this.bonjourBrowser) {
          return;
        }
        this.bonjourBrowser.stop();
        this.bonjourBrowser = undefined;
      }
}


let discovery = new BonjourDiscoveryServer();
discovery.start();