
// import console from './console';

let _os = require('os');

let _mdnsServer = require('mdns-server');

let _debugMdns = false;
let _logMdns = true;

let _debug = function(s, _bs) {
  if (!_debugMdns) {
    return;
  }
  console.info(`mDNS debug: ${s}`);
};

let _log = function(s, _bs) {
  if (!_logMdns) {
    return;
  }
  console.info(`mDNS debug: ${s}`);
};

let _important = function(s, _bs) {
  console.info(`mDNS ${s}`);
};

let _warn = function(s, _bs) {
  console.info(`mDNS ${s}`);
};

// let _stripTrailingPeriod = function(val) {
//   return _.replace(val, /\..+$/, '');
// };

let _buildDiscoveryMessage = function(entry) {
  _debug(`building discovery message from ${JSON.stringify(entry)}`);
  return {
    deviceId: entry.deviceId,
    found: entry.found,
    deviceType: 'G3',
    ipAddress: `${entry.ipAddress}:${entry.port}`,
    ipv6: entry.ipv6,
    hostname: entry.hostname,
    origin: entry.hostname
  };
};

let _buildServiceEntry = function(deviceId, found, deviceType, ipAddress, ipv6, lastIpAddress, lastIpv6, hostname,
  text, lastSeenIpv4, lastSeenIpv6, upTrigger) {
  return {
    deviceId,
    found, // Found means that we have at least one proper ip adress for the glasses!
    deviceType,
    ipAddress,
    ipv6,
    lastIpAddress,
    lastIpv6,
    hostname,
    text, // Typically path=/rest/
    lastSeenIpv4, // Timestamp for most recent A answer for ipv4.
    lastSeenIpv6, // Timestamp for most recent AAA answer for ipv6.
    upTrigger // Trigger to send up, this is delayed by 5 sec to get potential second ip address.
  };
};

class MDNS {
  constructor() {
    this.services = new Map(); // Remember each discovered glasses here.
    this.onUpCallback = undefined; // Callback when glasses is detected as up.
    this.onDownCallback = undefined; // Callback when glasses is detected as down.
    this.networkInterfaces = ''; // Summary of the existing network interfaces.
    this.mdnsService = undefined; // The mdns-server instance.
    this.nextGlassesQuery = undefined; // Timeout to next query.
    this.ifaceSummary = '';
  }

  onUp = (callback) => {
    this.onUpCallback = callback;
  };

  onDown = (callback) => {
    this.onDownCallback = callback;
  };

  sendUp = (entry) => {
    if (entry.found === false ||
      (entry.ipAddress !== '' && entry.ipAddress !== entry.lastIpAddress) ||
      (entry.ipv6 !== '' && entry.ipv6 !== entry.lastIpv6)) {
      let ipv4 = entry.ipAddress;
      let {ipv6} = entry;
      if (entry.ipAddress !== entry.lastIpAddress || entry.ipv6 !== entry.lastIpv6) {
        this.sendDown(entry);
      }
      if (ipv4 !== 'delete') {
        entry.ipAddress = ipv4;
      }
      if (ipv6 !== 'delete') {
        entry.ipv6 = ipv6;
      }
      let clear_up_trigger = false;
      if (entry.ipAddress !== '' && entry.lastIpAddress !== entry.ipAddress) {
        entry.lastIpAddress = entry.ipAddress;
        clear_up_trigger = true;
      }
      if (entry.ipv6 !== '' && entry.lastIpv6 !== entry.ipv6) {
        entry.lastIpv6 = entry.ipv6;
        clear_up_trigger = true;
      }
      if (clear_up_trigger) {
        clearTimeout(entry.upTrigger);
        _debug(`clearing upTrigger and queuing up for ${entry.deviceId}`);
        // Add a delay of 5 seconds, so that we can receive a second ip adress before upping the service.
        // Typically first the A adress is set, then the AAAA is set. The delay
        // prevents the service from going down/up unecessarily. It really takes quite a bit of time here....
        entry.upTrigger = setTimeout(() => {
          _debug(`should up? ${entry.deviceId}`);
          if (entry.ipAddress !== '' || entry.ipv6 !== '') {
            _debug(`yep got at leas one ip, sending up for ${entry.deviceId}`);
            entry.found = true;
            this.onUpCallback(_buildDiscoveryMessage(entry));
          } else {
            _warn(`Oups, time to send up, but no valid ip address! ${entry.deviceId}`);
          }
        }, 5000);
      }
    } else {
      _debug(`Not sending up for ${entry.deviceId} already up and no change detected.`);
    }
  };

  sendDown = (entry) => {
    if (entry.found === true) {
      clearTimeout(entry.upTrigger);
      entry.found = false;
      _debug(`sending down for ${entry.deviceId} and clear its upTrigger`);
      // Install the addresses used when this service was taken up!
      // Maybe not strictly necessary, but will reduce confusion of the callback receipient.
      entry.ipAddress = entry.lastIpAddress;
      entry.ipv6 = entry.lastIpv6;
      // Now invoke callback.
      this.onDownCallback(_buildDiscoveryMessage(entry));
      entry.ipAddress = '';
      entry.ipv6 = '';
      entry.lastIpAddress = '';
      entry.lastIpv6 = '';
      entry.lastSeenIpv4 = 0;
      entry.lastSeenIpv6 = 0;
    } else {
      _debug(`Not sending down for ${entry.deviceId} already down.`);
    }
  };

  idExistsInCache = (id) => this.services.has(id);

  lookupCacheFromId = (id) => this.services.get(id);

  gotPTR = (id, type) => {
    let entry = {};
    if (this.services.has(id)) {
      entry = this.services.get(id);
    } else {
      entry = _buildServiceEntry(id, false, type, '', '', '', '', '', '', 0, 0, undefined);
      this.services.set(id, entry);
    }
    _debug(`service ${id} is alive"`);
  };

  markLastSeen = (hostname, ipversion) => {
    for (let id of this.services.keys()) {
      let entry = this.lookupCacheFromId(id);
      if (entry.hostname === hostname) {
        if (ipversion === 'ipv4') {
          entry.lastSeenIpv4 = (new Date()).getTime();
        }
        if (ipversion === 'ipv6') {
          entry.lastSeenIpv6 = (new Date()).getTime();
        }
      }
    }
  };

  updateTextInfo = (id, info) => {
    if (this.idExistsInCache(id)) {
      let entry = this.lookupCacheFromId(id);
      if (entry.text !== info) {
        entry.text = info;
        _log(`service ${id} uses text ${info}`);
      }
    }
  };

  updateServerInfo = (id, hostname, port) => {
    if (this.idExistsInCache(id)) {
      let entry = this.lookupCacheFromId(id);
      if (entry.hostname !== hostname || entry.port !== port) {
        entry.hostname = hostname;
        entry.port = port;
        _log(`service ${id} uses hostname ${hostname} and port ${port}`);
      }
    }
  };

  updateIP = (hostname, ipv4, ipv6) => {
    for (let id of this.services.keys()) {
      let entry = this.lookupCacheFromId(id);
      if (entry.hostname === hostname) {
        this.takeUpIfPossible(entry, ipv4, ipv6);
      }
    }
  };

  takeUpIfPossible = (entry, ipv4, ipv6) => {
    if (ipv4 !== '' && entry.ipAddress !== ipv4) {
      entry.ipAddress = ipv4;
      _log(`new ipv4 address ${ipv4} for hostname ${entry.hostname}`);
    }
    if (ipv6 !== '' && entry.ipv6 !== ipv6) {
      entry.ipv6 = ipv6;
      _log(`new ipv6 address ${ipv6} for hostname ${entry.hostname}`);
    }
    this.sendUp(entry);
  };

  clearSummary = () => {
    this.ifaceSummary = '';
  };

  addToSummary = (x) => {
    this.ifaceSummary = `${this.ifaceSummary}--${x}`;
  };

  checkIfNetworkInterfacesChanged = () => {
    this.clearSummary();
    let ifaces = _os.networkInterfaces();
    // Iterate over the existing named interfaces: lo, etho, wlp4s0 etc.
    for (let iface in ifaces) {
      let arr = ifaces[iface];
      // Iterate over the network addresses stored for the named interfaces.
      let arrok = arr.filter(function(o) {
        return o.internal === false;
      });
      arrok.forEach((x) => {
        // Accumlate only the non-internal network address into the status summary.
        this.addToSummary(`(${iface},${x.family},${x.address},${x.netmask})`);
      });
    }

    if (this.networkInterfaceSummary !== this.ifaceSummary) {
      _debug(`old network interfaces: ${this.networkInterfaceSummary}`);
      _debug(`new network interfaces: ${this.ifaceSummary}`);
      let info = this.ifaceSummary;
      if (info === '') {
        info = '<no interfaces found>';
      }
      _important(`network interfaces changed from: ${this.networkInterfaceSummary}`);
      _important(`                             to: ${info}`);
      this.networkInterfaceSummary = this.ifaceSummary;
      _log('network interfaces changed, trigger a restart of the mDNS service');
      this.restart();
      return true;
    }
    return false;
  };

  sendGlassesQuery = () => {
    clearTimeout(this.nextGlassesQuery);
    if (this.mdnsService === undefined) {
      // This module is shutting down! Bail out.
      return;
    }
    if (this.checkIfNetworkInterfacesChanged()) {
      // Bail out and expect to be called again, when the mDNS service has restarted.
      return;
    }
    this.detectLostGlasses();

    _debug('sending query for _tobii-g3api._tcp.local');
    try {
      this.mdnsService.query({
        questions: [{
          name: '_tobii-g3api._tcp.local',
          type: 'PTR'
        }]
      });
      this.nextGlassesQuery = setTimeout(this.sendGlassesQuery, 5000);
    } catch (err) {
      this.handleError(err);
    }
  };

  detectLostGlasses = () => {
    let now = new Date();
    let now_millis = now.getTime();
    _debug(`checking lastSeen for services ${now}`);
    for (let id of this.services.keys()) {
      let entry = this.lookupCacheFromId(id);
      let delta_ipv4_s = (now_millis - entry.lastSeenIpv4) / 1000;
      if (entry.lastSeenIpv4 === 0) {
        delta_ipv4_s = -1;
      }
      let delta_ipv6_s = (now_millis - entry.lastSeenIpv6) / 1000;
      if (entry.lastSeenIpv6 === 0) {
        delta_ipv6_s = -1;
      }
      _log(`service ${id} seen seconds ago: ipv4 ${delta_ipv4_s} ipv6 ${delta_ipv6_s}`);
      let must_update = false;
      let new_ipv4 = entry.ipAddress;
      let new_ipv6 = entry.ipv6;
      if (delta_ipv4_s > 12 && entry.ipAddress !== '') {
        new_ipv4 = 'delete';
        must_update = true;
      }
      if (delta_ipv6_s > 12 && entry.ipv6 !== '') {
        new_ipv6 = 'delete';
        must_update = true;
      }

      // Oups! It has gone more than 12 seconds since we last saw an A or AAAA response.
      if (must_update) {
        // This will trigger a down of the services with this hostname.
        _important(`service ${id} must update ips ipv4 ${new_ipv4} ipv6 ${new_ipv6} `);
        this.updateIP(entry.hostname, new_ipv4, new_ipv6);
      }
    }
  };

  handleQuery = (query) => {
    _debug(`received query packet: ${JSON.stringify(query.questions)}`, this);
  };

  handleDestroy = () => {
    _debug('mDNS service destroyed.', this);
  };

  handleReady = () => {
    _log('mDNS service started');
    this.sendGlassesQuery();
  };

  handleResponse = (response) => {
    _debug(`received a response packet with ${response.answers.length} answers.`);
    response.answers.forEach((answer) => {
      let data_as_json = JSON.stringify(answer.data);
      _debug(`answer ${answer.name}, type: ${answer.type}, data: ${data_as_json}`);
      if (answer.name === '_tobii-g3api._tcp.local' &&
        answer.type === 'PTR') {
        // Example: Name: _tobii-g3api._tcp.local, type: PTR, data: "TG03B-080200100321._tobii-g3api._tcp.local"
        let id = answer.data;
        let type = answer.name;
        this.gotPTR(id, type);
      }
      if (answer.type === 'TXT') {
        // Example: mDNS debug: answer TG03B-080200100321._tobii-g3api._tcp.local, type: TXT,
        //      data: {"type":"Buffer","data":[11,112,97,116,104,61,47,114,101,115,116,47]}
        let id = answer.name;
        if (Buffer.isBuffer(answer.data)) {
          let info = answer.data.toString(); // Strip initial char 11, why is it there? A length indicator?
          this.updateTextInfo(id, info);
        }
      }
      if (answer.type === 'SRV') {
        // Example: Name: TG03B-080200100321._tobii-g3api._tcp.local, type: SRV,
        //      data: {"priority":0,"weight":0,"port":80,"target":"TG03B-080200100321.local"
        let id = answer.name;
        let hostname = answer.data.target;
        let {port} = answer.data;
        this.updateServerInfo(id, hostname, port);
      }
      if (answer.type === 'A') {
        // Example: Name: TG03B-080200100321.local, type: A, data: "192.168.75.51"
        let hostname = answer.name;
        let ipv4 = answer.data;
        this.updateIP(hostname, ipv4, '');
        this.markLastSeen(hostname, 'ipv4');
      }
      if (answer.type === 'AAAA') {
        // Example: Name: TG03B-080200100321.local, type: A, data: "1111:2222:3333:4444:5555:6666:7777:8888"
        let hostname = answer.name;
        let ipv6 = answer.data;
        this.updateIP(hostname, '', ipv6);
        this.markLastSeen(hostname, 'ipv6');
      }
    });
  };

  restart = () => {
    this.stop();
    this.start();
  };

  stop = () => {
    if (this.mdnsService) {
      try {
        _debug('stopping mDNS service');
        this.mdnsService.destroy();
      } catch (err) {
        _debug(`error message: ${JSON.stringify(err)}`);
        _warn('error when stopping mDNS service');
      }
      this.mdnsService = undefined;
      _debug('stopped mDNS service');
    }
  };

  handleError = (err) => {
    if (this.mdnsService) {
      _warn(`${err} Restarting service in 5 seconds`);
      this.stop();
      // Try to start again in 5 seconds....
      this.detectLostGlasses();
      setTimeout(this.start, 5000);
    } else {
      _warn(`${err}`);
    }
  };

  handleWarning = (warn) => {
    _warn(`${warn}`, this);
  };

  start = () => {
    if (this.onUpCallback === undefined) {
      _warn('cannot start mDNS service because onUp callback is not set!');
      return;
    }
    if (this.onDownCallback === undefined) {
      _warn('cannot start mDNS service because onDown callback is not set!');
      return;
    }
    if (this.mdnsService !== undefined) {
      _warn('cannot start mDNS service since it seems to be already started!');
      return;
    }
    if (this.checkIfNetworkInterfacesChanged()) {
      // Bail out and expect to be called again.
      return;
    }

    _debug('starting mDNS service');

    try {
      this.mdnsService = _mdnsServer({
        reuseAddr: true, // in case other mdns service is running
        loopback: false, // receive our own mdns messages
        noInit: true // do not initialize on creation
      });

      this.mdnsService.on('error', this.handleError);
      this.mdnsService.on('warning', this.handleWarning);
      this.mdnsService.on('query', this.handleQuery);
      this.mdnsService.on('response', this.handleResponse);
      this.mdnsService.on('destroyed', this.handleDestroy);
      this.mdnsService.on('ready', this.handleReady);
      this.mdnsService.initServer();
      _debug('started mDNS');
    } catch (err) {
      this.handleError(err);
    }
  };
}

// export default MDNS;


let discovery = new MDNS();
discovery.onUp( (dm) => {   console.log('\n\n********* UP '+JSON.stringify(dm)+'\n\n'); });
discovery.onDown( (dm) => { console.log('\n\n********* DOWN '+JSON.stringify(dm)+'\n\n'); });

discovery.start();

