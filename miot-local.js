/*!
 * miot-local.js v1.0.0
 * https://github.com/qudou/miot-local
 * (c) 2009-2017 qudou
 * Released under the MIT license
 */

const mosca = require("mosca");
const xmlplus = require("xmlplus");
const ID = "195b858f-442e-4b45-8875-a32ccf7a46e0";
const Gateway = "c55d5e0e-f506-4933-8962-c87932e0bc2a";

xmlplus("miot-local", (xp, $_, t) => {

$_().imports({
    Index: {
        xml: "<main id='index'>\
                <Mosca id='mosca'/>\
                <Proxy id='proxy'/>\
              </main>",
        map: { share: "sqlite/Sqlite mosca/Links mosca/Parts" }
    },
    Mosca: {
        xml: "<main id='mosca' xmlns:i='mosca'>\
                <i:Authorize id='auth'/>\
                <i:Parts id='parts'/>\
              </main>",
        fun: async function (sys, items, opts) {
            let options = await items.parts.data();
            let server = new mosca.Server({port: 1883});            
            server.on("ready", async () => {
                await items.parts.offlineAll();
                Object.keys(items.auth).forEach(k => server[k] = items.auth[k]);
                console.log("Mosca server is up and running"); 
            });
            server.on("subscribed", async (topic, client) => {
                let data = options[topic].data;
                items.parts.update(topic, 1);
                this.notify("to-part", [topic, {topic: "message", body: data}]);
                this.notify("to-gateway", {ssid: topic, online: 1, data: data});
            });
            server.on("unsubscribed", (topic, client) => {
                items.parts.update(topic, 0);
                this.notify("to-gateway", {ssid: topic, online: 0});
            });
            server.on("published", async (packet, client) => {
                if (client == undefined) return;
                if (packet.topic == "to-gateway") {
                    let msg = JSON.parse(packet.payload + '');
                    xp.extend(options[msg.ssid].data, msg.data);
                    items.parts.cache(msg.ssid, options[msg.ssid].data);
                    this.notify("to-gateway", {ssid: msg.ssid, data: msg.data});
                }
            });
            this.watch("to-part", (e, topic, msg) => {
                server.publish({topic: topic, payload: JSON.stringify(msg), qos: 1, retain: false});
            });
        }
    },
    Proxy: {
        xml: "<Parts id='parts' xmlns='mosca'/>",
        opt: { server: "mqtt://t-store.cn:1883", clientId: ID },
        fun: function (sys, items, opts) {
            let client  = require("mqtt").connect(opts.server, opts);
            client.on("connect", async e => {
                client.subscribe(opts.clientId);
                let parts = await items.parts.data();
                xp.each(parts, (key, item) => {
                    this.notify("to-gateway", {ssid: item.ssid, online: item.online, data: item.data});
                });
                console.log("connected to " + opts.server);
            });
            client.on("message", (topic, msg) => {
                msg = JSON.parse(msg.toString());
                this.notify("to-part", [msg.ssid, msg.body]);
            });
            this.watch("to-gateway", (e, payload) => {
                client.publish(Gateway, JSON.stringify(payload), {qos: 1, retain: false});
            });
        }
    }
});

$_("mosca").imports({
    Authorize: {
        xml: "<main id='authorize'>\
                <Links id='links'/>\
                <Parts id='parts'/>\
              </main>",
        fun: function (sys, items, opts) {
            async function authenticate(client, user, pass, callback) {
                callback(null, await items.links.canLink(client.id));
            }
            async function authorizeSubscribe(client, topic, callback) {
                callback(null, await items.parts.canSubscribe(topic));
            }
            return { authenticate: authenticate, authorizeSubscribe: authorizeSubscribe };
        }
    },
    Links: {
        xml: "<Sqlite id='sqlite' xmlns='/sqlite'/>",
        fun: function (sys, items, opts) {
            function canLink(linkId) {
                return new Promise((resolve, reject) => {
                    let stmt = `SELECT * FROM links WHERE id = '${linkId}'`;
                    items.sqlite.all(stmt, (err, data) => {
                        if (err) throw err;
                        resolve(!!data.length);
                    });
                });
            }
            return { canLink: canLink };
        }
    },
    Parts: {
        xml: "<Sqlite id='sqlite' xmlns='/sqlite'/>",
        fun: function (sys, items, opts) {
            function canSubscribe(partId) {
                return new Promise((resolve, reject) => {
                    let stmt = `SELECT parts.* FROM links, parts WHERE parts.id = '${partId}' AND parts.link = links.id AND parts.online = 0`;
                    items.sqlite.all(stmt, (err, data) => {
                        if (err) throw err;
                        resolve(!!data.length);
                    });
                });
            }
            function data() {
                return new Promise(resolve => {
                    items.sqlite.all("SELECT * FROM parts", (err, rows) => {
                        if (err) throw err;
                        let table = {};
                        rows.forEach(item => {
                            item.ssid = item.id;
                            delete item.id;
                            item.data = JSON.parse(item.data);
                            table[item.ssid] = item;
                        });
                        resolve(table);
                    });
                });
            }
            function update(id, online) {
                let stmt = items.sqlite.prepare("UPDATE parts SET online=? WHERE id=?");
                stmt.run(online, id, err => {
                    if (err) throw err;
                });
            }
            function cache(id, data) {
                let stmt = items.sqlite.prepare("UPDATE parts set data = ? WHERE id = ?");
                stmt.run(JSON.stringify(data), id, err => {
                    if (err) throw err;
                });
            }
            function offlineAll() {
                return new Promise((resolve, reject) => {
                    let stmt = items.sqlite.prepare("UPDATE parts SET online=?");
                    stmt.run(0, err => {
                        if (err) throw err;
                        resolve(true);
                    });
                });
            }
            return { canSubscribe: canSubscribe, data: data, update: update, cache: cache, offlineAll: offlineAll };
        }
    }
});

$_("sqlite").imports({
    Sqlite: {
        fun: function (sys, items, opts) {
            let sqlite = require("sqlite3").verbose(),
                db = new sqlite.Database(`${__dirname}/data.db`);
            db.exec("VACUUM");
            db.exec("PRAGMA foreign_keys = ON");
            return db;
        }
    },
    Prepare: {
        fun: function (sys, items, opts) {
            return stmt => {
                let args = [].slice.call(arguments).slice(1);
                args.forEach(item => {
                    stmt = stmt.replace("?", typeof item == "string" ? '"' + item + '"' : item);
                });
                return stmt;
            };
        }
    }
});

}).startup("//miot-local/Index");