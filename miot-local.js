/*!
 * miot-local.js v1.0.4
 * https://github.com/qudou/miot-local
 * (c) 2009-2017 qudou
 * Released under the MIT license
 */

const mosca = require("mosca");
const xmlplus = require("xmlplus");
const fs = require("fs");
const uid = "5ab6f0a1-e2b5-4390-80ae-3adf2b4ffd40";
const config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`)
                            .toString().replace(/dir/g, __dirname));

xmlplus("miot-local", (xp, $_) => { // 局域网关

$_().imports({
    Index: {
        xml: "<main id='index'>\
                <Mosca id='mosca'/>\
                <Proxy id='proxy'/>\
              </main>",
        map: { share: "mosca/Utils" }
    },
    Mosca: { // 本服务器用于连接网内客户端
        xml: "<main id='mosca' xmlns:i='mosca'>\
                <i:Authorize id='auth'/>\
                <i:Utils id='utils'/>\
              </main>",
        fun: async function (sys, items, opts) {
            let { pathToRegexp, match, parse, compile } = require("path-to-regexp");
            let server = new mosca.Server(config.mosca);
            server.on("ready", async () => {
                await items.utils.offlineAll();
                Object.keys(items.auth).forEach(k => server[k] = items.auth[k]);
                console.log("Mosca server is up and running"); 
            });
            server.on("subscribed", async (topic, client) => {
                await items.utils.update(topic, 1);
                this.notify("to-gateway", {pid: topic, online: 1});
            });
            server.on("unsubscribed", async (topic, client) => {
                await items.utils.update(topic, 0);
                this.notify("to-gateway", {pid: topic, online: 0});
            });
            server.on("published", async (packet, client) => {
                if (client == undefined) return;
                let p, r, l;
                switch (packet.topic) {
                  case "to-parts":
                    p = JSON.parse(packet.payload + '');
                    r = pathToRegexp(p.targets, [], {});
                    l = await items.utils.data();
                    for (let i in l)
                        r.exec(l[i].path) && this.notify("to-part", [l[i].id, {topic: p.topic, pid: p.pid, body: p.body}]);
                    break;
                  case "to-gateway":
                    this.notify("to-gateway", JSON.parse(packet.payload + ''));
                  default:;
                }
            });
            this.watch("to-part", (e, topic, payload) => {
                payload = JSON.stringify(payload);
                server.publish({topic: topic, payload: payload, qos: 1});
            });
        }
    },
    Proxy: {  // 本代理作为客户端连接至远程云服务器
        xml: "<Utils id='utils' xmlns='mosca'/>",
        fun: function (sys, items, opts) {
            let proxy = config.proxy;
            let mqtt = require("mqtt");
            proxy.ca = proxy.ca && fs.readFileSync(proxy.ca).toString();
            let client  = mqtt.connect(proxy);
            client.on("connect", async e => {
                client.subscribe(proxy.clientId);
                let parts = await items.utils.data();
                this.watch("to-gateway", toGateway);
                xp.each(parts, (key, item) => {
                    this.notify("to-gateway", {pid: item.id, online: item.online});
                });
                console.log(`connected to ${proxy.protocol}://${proxy.host}:${proxy.port}`);
            });
            client.on("message", (topic, payload) => {
                let p = JSON.parse(payload.toString());
                this.notify("to-part", [p.pid, p.body]);
            });
            function toGateway(e, payload) {
                payload = JSON.stringify(payload);
                client.publish(uid, payload, {qos: 1});
            }
            client.on("close", () => this.unwatch("to-gateway"));
        }
    }
});

$_("mosca").imports({
    Authorize: {
        xml: "<Utils id='utils'/>",
        fun: function (sys, items, opts) {
            async function authenticate(client, user, pass, callback) {
                callback(null, true);
            }
            async function authorizeSubscribe(client, topic, callback) {
                callback(null, await items.utils.canSubscribe(topic));
            }
            return { authenticate: authenticate, authorizeSubscribe: authorizeSubscribe };
        }
    },
    Utils: {
        fun: function (sys, items, opts) {
            let parts = {};
            config.parts.forEach(i => parts[i.id] = i)
            function canSubscribe(id) {
                return parts[id] && parts[id].online == 0
            }
            function data() {
                return parts;
            }
            function update(id, online) {
                parts[id] && (parts[id].online = online);
            }
            function offlineAll() {
                for (let i in parts)
                    parts[i].online = 0;
            }
            return { canSubscribe: canSubscribe, data: data, update: update, offlineAll: offlineAll };
        }
    }
});

}).startup("//miot-local/Index");