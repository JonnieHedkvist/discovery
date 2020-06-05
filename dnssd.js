const dnssd = require('dnssd2');
const {performance} = require('perf_hooks');

const G3ServiceType = 'tobii-g3api';
let browsInterval;

class DnsSdDiscoveryServer {
    startedBrowsingTime;
    dnssdBrowser;

    start = () => {
        console.log('Starting Discovery Service....');

        this._setupDnssd2();
        browsInterval = setInterval(() => {
            this._teardownDnssd2();
            this._setupDnssd2();
        }, 10000);
    }

    _setupDnssd2 = () => {
        console.log('Starting DNSSD Browser');
        this.startedBrowsingTime = performance.now();

        this.dnssdBrowser = dnssd.Browser(dnssd.tcp(G3ServiceType))
          .on('serviceUp', (service) => {
            console.log(`DNSSD -- Found Service after (${performance.now() - this.startedBrowsingTime} milliseconds)`, service);
          })
          .on('serviceDown', (service) => {
            console.log('LOST DNSSD Service:', service);
          })
          .on('error', (err) => {
            logger.error('Error in DNSSD Discovery::', err);
          })
          .start();
      }
    
      _teardownDnssd2 = () => {
        if (!this.dnssdBrowser) {
          return;
        }
        this.dnssdBrowser.stop();
        this.dnssdBrowser = undefined;
      }
}


let discovery = new DnsSdDiscoveryServer();
discovery.start();