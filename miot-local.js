/*!
 * miot-local.js v1.0.2
 * https://github.com/qudou/miot-local
 * (c) 2009-2017 qudou
 * Released under the MIT license
 */

const mosca = require("mosca");
const xmlplus = require("xmlplus");
const config = JSON.parse(require("fs").readFileSync(`${__dirname}/config.json`));

xmlplus("miot-local", (xp, $_) => {

$_().imports({
    Index: {
        xml: "<main id='index'>\
                <Mosca id='mosca'/>\
                <Proxy id='proxy'/>\
              </main>",
        map: { share: "mosca/Utils" }
    },
    Mosca: { // 本 MQTT 服务器用于连接局域网内的 MQTT 客户端
        xml: "<main id='mosca' xmlns:i='mosca'>\
                <i:Authorize id='auth'/>\
                <i:Utils id='utils'/>\
              </main>",
        fun: async function (sys, items, opts) {
            let { pathToRegexp, match, parse, compile } = require("path-to-regexp");
            let server = new mosca.Server({port: config.port});
            server.on("ready", async () => {
                await items.utils.offlineAll();
                Object.keys(items.auth).forEach(k => server[k] = items.auth[k]);
                console.log("Mosca server is up and running"); 
            });
            server.on("subscribed", async (topic, client) => {
                await items.utils.update(topic, 1);
                this.notify("to-gateway", {topic: "/SYS", pid: topic, online: 1});
            });
            server.on("unsubscribed", async (topic, client) => {
                await items.utils.update(topic, 0);
                this.notify("to-gateway", {topic: "/SYS", pid: topic, online: 0});
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
                    p = JSON.parse(packet.payload + '');
                    if (p.topic == "/SYS")
                        items.utils.update(p.pid, p.online);
                    this.notify("to-gateway", p);
                  default:;
                }
            });
            this.watch("to-part", (e, topic, payload) => {
                payload = JSON.stringify(payload);
                server.publish({topic: topic, payload: payload, qos: 1, retain: true});
            });
        }
    },
    Proxy: {  // 本代理作为客户端连接至远程云服务器
        xml: "<Utils id='utils' xmlns='mosca'/>",
        fun: async function (sys, items, opts) {
            let client  = require("mqtt").connect(config.server, {clientId: config.client_id});
            client.on("connect", async e => {
                client.subscribe(config.client_id);
                let parts = await items.utils.data();
                xp.each(parts, (key, item) => {
                    this.notify("to-gateway", {topic: "/SYS", pid: item.pid, online: item.online});
                });
                console.log("connected to " + config.server);
            });
            client.on("message", (topic, payload) => {
                let p = JSON.parse(payload.toString());
                this.notify("to-part", [p.pid, p.body]);
            });
            this.watch("to-gateway", (e, payload) => {
                payload = JSON.stringify(payload);
                client.publish("/SYS", payload, {qos: 1, retain: true});
            });
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