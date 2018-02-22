/*!
 * miot-local.js v1.0.0
 * https://github.com/qudou/miot
 * (c) 2009-2017 qudou
 * Released under the MIT license
 */

const mosca = require("mosca");
const xmlplus = require("xmlplus");
const ID = "aee81434-fe5f-451a-b522-ae4631da5f45";
const Gateway = "c55d5e0e-f506-4933-8962-c87932e0bc2a";

xmlplus("miot-local", (xp, $_, t) => {

$_().imports({
    Index: {
        xml: "<main id='index'>\
                <Mosca id='mosca'/>\
                <Proxy id='proxy'/>\
              </main>",
        map: { share: "sqlite/Sqlite mosca/Parts" }
    },
    Mosca: {
        xml: "<main id='mosca' xmlns:i='mosca'>\
                <i:Authorize id='auth'/>\
                <i:Parts id='parts'/>\
              </main>",
        fun: async function (sys, items, opts) {
            let options = await items.parts.data();
            let server = new mosca.Server({port: 1883});
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
                if (packet.topic == ID) {
                    let msg = JSON.parse(packet.payload + '');
                    xp.extend(options[msg.ssid].data, msg.data);
                    items.parts.cache(msg.ssid, options[msg.ssid].data);
                    this.notify("to-gateway", {ssid: msg.ssid, data: msg.data});
                }
            });
            server.on("ready", async () => {
                await items.parts.offlineAll();
                Object.keys(items.auth).forEach(k => server[k] = items.auth[k]);
                console.log("Mosca server is up and running"); 
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
                for (let item in parts)
                    this.notify("to-gateway", {ssid: item.ssid, online: item.online, data: item.data});
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
        xml: "<Parts id='parts'/>",
        fun: function (sys, items, opts) {
            async function authorizeSubscribe(client, topic, callback) {
                callback(null, await items.parts.canSubscribe(topic));
            }
            return { authorizeSubscribe: authorizeSubscribe };
        }
    },
    Parts: {
        xml: "<Sqlite id='sqlite' xmlns='/sqlite'/>",
        fun: function (sys, items, opts) {
            function canSubscribe(partId) {
                return new Promise((resolve, reject) => {
                    let stmt = `SELECT * FROM parts WHERE id = '${partId}' AND online = 0`;
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
                let stmt = items.sqlite.prepare("INSERT Or REPLACE INTO parts VALUES (?,?,?)");
                stmt.run(id, JSON.stringify(data), 1, err => {
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