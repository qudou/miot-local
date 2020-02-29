/*!
 * miot-local.js v1.0.0
 * https://github.com/qudou/miot-local
 * (c) 2009-2017 qudou
 * Released under the MIT license
 */

const mosca = require("mosca");
const xmlplus = require("xmlplus");

xmlplus("miot-local", (xp, $_) => {

$_().imports({
    Index: {
        xml: "<main id='index'>\
                <Mosca id='mosca'/>\
                <Proxy id='proxy'/>\
              </main>",
        map: { share: "mosca/Sqlite mosca/Links mosca/Parts" }
    },
    Mosca: { // 本 MQTT 服务器用于连接局域网内的 MQTT 客户端
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
                await items.parts.update(topic, 1);
                this.notify("to-gateway", {topic: "/SYS", pid: topic, online: 1});
            });
            server.on("unsubscribed", async (topic, client) => {
                await items.parts.update(topic, 0);
                this.notify("to-gateway", {topic: "/SYS", pid: topic, online: 0});
            });
            server.on("published", (packet, client) => {
                if (client == undefined) return;
                if (packet.topic == "to-gateway") {
                    let payload = JSON.parse(packet.payload + '');
                    if (payload.topic == "/SYS")
                        items.parts.update(payload.pid, payload.online);
                    this.notify("to-gateway", payload);
                }
            });
            this.watch("to-part", (e, topic, payload) => {
                payload = JSON.stringify(payload);
                server.publish({topic: topic, payload: payload, qos: 1, retain: true});
            });
        }
    },
    Proxy: {  // 本代理作为客户端连接至远程云服务器
        xml: "<main id='proxy' xmlns:i='mosca'>\
                <i:Sqlite id='db'/>\
                <i:Parts id='parts'/>\
              </main>",
        fun: async function (sys, items, opts) {
            let opts_ = await options();
            let client  = require("mqtt").connect(opts_.server, {clientId: opts_.client_id});
            client.on("connect", async e => {
                client.subscribe(opts_.client_id);
                let parts = await items.parts.data();
                xp.each(parts, (key, item) => {
                    this.notify("to-gateway", {topic: "/SYS", pid: item.pid, online: item.online});
                });
                console.log("connected to " + opts_.server);
            });
            client.on("message", (topic, payload) => {
                let p = JSON.parse(payload.toString());
                this.notify("to-part", [p.pid, p.body]);
            });
            this.watch("to-gateway", (e, payload) => {
                payload = JSON.stringify(payload);
                client.publish(opts_.gateway, payload, {qos: 1, retain: true});
            });
            function options() {
                return new Promise((resolve, reject) => {
                    items.db.all(`SELECT * FROM options`, (err, data) => {
                        if (err) throw err;
                        let obj = {};
                        data.forEach(i => obj[i.key] = i.value);
                        resolve(obj);
                    });
                });
            }
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
        xml: "<Sqlite id='db'/>",
        fun: function (sys, items, opts) {
            function canLink(linkId) {
                return new Promise((resolve, reject) => {
                    let stmt = `SELECT * FROM links WHERE id = '${linkId}'`;
                    items.db.all(stmt, (err, data) => {
                        if (err) throw err;
                        resolve(!!data.length);
                    });
                });
            }
            return { canLink: canLink };
        }
    },
    Parts: {
        xml: "<Sqlite id='db'/>",
        fun: function (sys, items, opts) {
            function canSubscribe(partId) {
                return new Promise((resolve, reject) => {
                    let stmt = `SELECT parts.* FROM links, parts WHERE parts.id = '${partId}' AND parts.link = links.id AND parts.online = 0`;
                    items.db.all(stmt, (err, data) => {
                        if (err) throw err;
                        resolve(!!data.length);
                    });
                });
            }
            function data() {
                return new Promise(resolve => {
                    items.db.all("SELECT * FROM parts", (err, rows) => {
                        if (err) throw err;
                        let table = {};
                        rows.forEach(item => {
                            item.pid = item.id;
                            delete item.id;
                            table[item.pid] = item;
                        });
                        resolve(table);
                    });
                });
            }
            function update(id, online) {
                return new Promise(resolve => {
                    let stmt = items.db.prepare("UPDATE parts SET online=? WHERE id=?");
                    stmt.run(online, id, err => {
                        if (err) throw err;
                        resolve(true);
                    });
                });
            }
            function offlineAll() {
                return new Promise((resolve, reject) => {
                    let stmt = items.db.prepare("UPDATE parts SET online=?");
                    stmt.run(0, err => {
                        if (err) throw err;
                        resolve(true);
                    });
                });
            }
            return { canSubscribe: canSubscribe, data: data, update: update, offlineAll: offlineAll };
        }
    },
    Sqlite: {
        fun: function (sys, items, opts) {
            let sqlite = require("sqlite3").verbose(),
                db = new sqlite.Database(`${__dirname}/data.db`);
            db.exec("VACUUM");
            db.exec("PRAGMA foreign_keys = ON");
            return db;
        }
    }
});

}).startup("//miot-local/Index");