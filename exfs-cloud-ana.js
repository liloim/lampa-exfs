/*!
 * EX-FS for Lampa
 * Cloud version
 * Version: 1.2.0
 *
 * Requires your own Cloudflare Worker URL in:
 * Settings -> EX-FS -> Cloudflare Worker URL
 */

(function () {
    'use strict';

    var VERSION = '1.2.0';
    var DOMAIN = 'https://ex-fs.net';
    var COMPONENT = 'exfs_cloud_v12';
    var FRAME_COMPONENT = 'exfs_cloud_frame_v12';
    var STORAGE_WORKER = 'exfs_cloud_worker_url';

    if (window.__exfs_cloud_v12_loaded) return;
    window.__exfs_cloud_v12_loaded = true;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalize(value) {
        return clean(value)
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[–—−‐‑‒―]/g, '-')
            .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function workerUrl() {
        return 'https://falling-sun-64c0.ana-pivot.workers.dev';
    }

    function proxyUrl(target) {
        var worker = workerUrl();

        if (!worker) return '';

        return worker + '/proxy?url=' + encodeURIComponent(target);
    }

    function absolute(url, base) {
        url = clean(url);
        base = base || DOMAIN + '/';

        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf('//') === 0) return 'https:' + url;

        try {
            return new URL(url, base).href;
        } catch (e) {
            if (url.charAt(0) === '/') return DOMAIN + url;
            return DOMAIN + '/' + url;
        }
    }

    function htmlRoot(html) {
        var box = document.createElement('div');
        box.innerHTML = html || '';
        return box;
    }

    function checkWorkerHealth() {
        try {
            var network = new Lampa.Reguest();
            network.timeout(10000);

            network.silent(
                'https://falling-sun-64c0.ana-pivot.workers.dev/health',
                function (data) {
                    try {
                        var obj = typeof data === 'string' ? JSON.parse(data) : data;
                        if (obj && obj.ok) {
                            Lampa.Noty.show('EX-FS: Worker OK');
                        } else {
                            Lampa.Noty.show('EX-FS: Worker відповів, але health некоректний');
                        }
                    } catch (e) {
                        Lampa.Noty.show('EX-FS: Worker health не JSON');
                    }
                },
                function () {
                    Lampa.Noty.show('EX-FS: Worker недоступний');
                },
                false,
                { dataType: 'text' }
            );
        } catch (e) {}
    }

    function requestTarget(target, done, fail, post, headers) {
        var purl = proxyUrl(target);

        if (!purl) {
            fail('worker_missing', 'Worker URL не заданий');
            return;
        }

        var network = new Lampa.Reguest();
        network.timeout(20000);

        network.silent(
            purl,
            function (data) {
                if (typeof data !== 'string') {
                    if (data && typeof data.body === 'string') data = data.body;
                    else data = String(data || '');
                }

                done(data);
            },
            function (a, b) {
                fail(a, b, network);
            },
            post || false,
            {
                dataType: 'text',
                headers: headers || {}
            }
        );

        return network;
    }

    function nearestContainer(node) {
        var cur = node;

        for (var i = 0; i < 6 && cur; i++) {
            var cls = ' ' + (cur.className || '') + ' ';

            if (
                / short | story | post | movie | item | card | search | result | th-item | shortstory /i.test(cls) ||
                /^(article|li)$/i.test(cur.tagName || '')
            ) return cur;

            cur = cur.parentNode;
        }

        return node.parentNode || node;
    }

    function titleFromAnchor(a, container) {
        var value = clean(a.getAttribute('title'));

        if (!value && a.querySelector) {
            var img = a.querySelector('img[alt]');
            if (img) value = clean(img.getAttribute('alt'));
        }

        if (!value) value = clean(a.textContent);

        if ((!value || value.length < 2) && container && container.querySelector) {
            var h = container.querySelector(
                'h1,h2,h3,h4,.title,.name,.short-title,.shortstory__title,.th-title,.th-name,.movie-title'
            );
            if (h) value = clean(h.textContent);
        }

        return value
            .replace(/\s*(смотреть|дивитися|watch)\s+онлайн.*$/i, '')
            .replace(/\s*онлайн\s*$/i, '')
            .trim();
    }

    function parseSearch(html, query, wantedYear) {
        var root = htmlRoot(html);
        var anchors = root.querySelectorAll('a[href]');
        var out = [];
        var seen = {};
        var q = normalize(query);

        Array.prototype.forEach.call(anchors, function (a) {
            var href = clean(a.getAttribute('href'));

            if (!href) return;

            if (!/\/(?:film|films|serial|serials|multfilm|multserial|tv-show|show|anime|documental|peredachi)\/[^?#"']+\.html(?:$|[?#])/i.test(href)) {
                return;
            }

            var url = absolute(href);
            if (!url || seen[url]) return;

            var container = nearestContainer(a);
            var title = titleFromAnchor(a, container);
            if (!title || title.length < 2) return;

            var allText = clean(container && container.textContent);
            var ym = allText.match(/\b(19|20)\d{2}\b/);
            var year = ym ? ym[0] : '';
            var nt = normalize(title);
            var score = 0;

            if (nt === q) score += 100;
            else if (nt.indexOf(q) !== -1 || q.indexOf(nt) !== -1) score += 60;
            else {
                var parts = q.split(' ');
                var hits = 0;

                parts.forEach(function (part) {
                    if (part.length > 1 && nt.indexOf(part) !== -1) hits++;
                });

                score += hits * 8;
            }

            if (wantedYear && year && String(wantedYear) === String(year)) score += 30;

            seen[url] = true;
            out.push({
                title: title,
                year: year,
                url: url,
                score: score
            });
        });

        out.sort(function (a, b) {
            return b.score - a.score;
        });

        return out.slice(0, 25);
    }

    function searchMovie(movie, done, fail) {
        var title = movie.title || movie.name || movie.original_title || movie.original_name || '';
        var date = movie.release_date || movie.first_air_date || '';
        var year = (String(date).match(/^(19|20)\d{2}/) || [''])[0];

        if (!title) {
            done([]);
            return;
        }

        var target =
            DOMAIN +
            '/index.php?do=search&subaction=search&story=' +
            encodeURIComponent(title);

        requestTarget(
            target,
            function (html) {
                done(parseSearch(html, title, year));
            },
            fail
        );
    }

    function parseMedia(pageUrl, html) {
        var root = htmlRoot(html);
        var direct = [];
        var frames = [];
        var directSeen = {};
        var frameSeen = {};

        function addDirect(url, title) {
            url = clean(url).replace(/&amp;/g, '&').replace(/\\\//g, '/');
            if (!url) return;

            url = absolute(url, pageUrl);

            if (!/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url)) return;
            if (directSeen[url]) return;

            directSeen[url] = true;

            direct.push({
                url: url,
                title: clean(title) || (/\.m3u8(?:$|[?#])/i.test(url) ? 'HLS' : 'MP4')
            });
        }

        function addFrame(url, title) {
            url = clean(url);
            if (!url) return;

            url = absolute(url, pageUrl);

            if (!/^https?:\/\//i.test(url)) return;
            if (/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(url)) return;
            if (frameSeen[url]) return;

            frameSeen[url] = true;

            frames.push({
                url: url,
                title: clean(title) || ('Плеєр ' + (frames.length + 1))
            });
        }

        Array.prototype.forEach.call(
            root.querySelectorAll('video[src],video source[src],source[src]'),
            function (el) {
                addDirect(el.getAttribute('src'), el.getAttribute('title'));
            }
        );

        Array.prototype.forEach.call(
            root.querySelectorAll('iframe[src],iframe[data-src],iframe[data-url]'),
            function (el) {
                addFrame(
                    el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-url'),
                    el.getAttribute('title') || el.getAttribute('data-title')
                );
            }
        );

        var text = String(html || '').replace(/\\\//g, '/');
        var re = /https?:\/\/[^"'<> \t\r\n\\]+?\.(?:m3u8|mp4)(?:\?[^"'<> \t\r\n\\]*)?/ig;
        var match;

        while ((match = re.exec(text))) {
            addDirect(match[0], '');
        }

        return {
            direct: direct,
            frames: frames
        };
    }

    function playDirect(stream, movie) {
        var item = {
            url: stream.url,
            title: movie.title || movie.name || 'EX-FS'
        };

        Lampa.Player.play(item);
        Lampa.Player.playlist([item]);
    }

    function FrameComponent(object) {
        var html = $('<div></div>');
        var frame = null;

        this.create = function () {
            html.css({
                position: 'fixed',
                left: '0',
                top: '0',
                width: '100%',
                height: '100%',
                background: '#000',
                zIndex: '9999'
            });

            frame = $('<iframe></iframe>');

            frame.attr({
                src: object.frame_url,
                allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
                allowfullscreen: 'true',
                referrerpolicy: 'strict-origin-when-cross-origin'
            });

            frame.css({
                width: '100%',
                height: '100%',
                border: '0',
                background: '#000'
            });

            html.append(frame);
            return html;
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add(FRAME_COMPONENT, {
                toggle: function () {
                    try { frame[0].focus(); } catch (e) {}
                },
                up: function () {},
                down: function () {},
                left: function () {},
                right: function () {},
                back: this.back
            });

            Lampa.Controller.toggle(FRAME_COMPONENT);
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            try {
                frame.attr('src', 'about:blank');
                frame.remove();
                html.remove();
            } catch (e) {}
        };
    }

    function row(title, subtitle) {
        return $(
            '<div class="online selector">' +
                '<div class="online__title">' + esc(title) + '</div>' +
                '<div class="online__quality">' + esc(subtitle || '') + '</div>' +
            '</div>'
        );
    }

    function CloudComponent(object) {
        var self = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var last = null;
        var results = [];

        this.create = function () {
            this.activity.loader(true);
            files.appendFiles(scroll.render());
            this.search();
            return this.render();
        };

        this.render = function () {
            return files.render();
        };

        this.reset = function () {
            last = null;
            scroll.render().find('.empty').remove();
            scroll.clear();
            scroll.reset();
        };

        this.empty = function (message) {
            this.reset();

            var empty = Lampa.Template.get('list_empty');
            empty.find('.empty__descr').text(message);

            scroll.append(empty);
            this.activity.loader(false);
            this.start(false);
        };

        this.append = function (item) {
            item.on('hover:focus', function (e) {
                last = e.target;
                scroll.update($(e.target), true);
            });

            scroll.append(item);
        };

        this.search = function () {
            if (!workerUrl()) {
                this.empty('EX-FS: Worker URL відсутній');
                return;
            }

            searchMovie(
                object.movie || {},
                function (items) {
                    results = items || [];
                    self.showResults();
                },
                function () {
                    self.empty('EX-FS: Worker не зміг отримати сторінку пошуку');
                }
            );
        };

        this.showResults = function () {
            this.reset();

            if (!results.length) {
                this.empty('EX-FS: нічого не знайдено');
                return;
            }

            results.forEach(function (result) {
                var item = row(
                    result.title,
                    result.year ? ('EX-FS • ' + result.year) : 'EX-FS'
                );

                item.on('hover:enter', function () {
                    self.openResult(result);
                });

                self.append(item);
            });

            this.activity.loader(false);
            this.start(true);
        };

        this.openResult = function (result) {
            this.activity.loader(true);
            this.reset();

            var back = row('← Назад', result.title);
            back.on('hover:enter', function () {
                self.showResults();
            });
            this.append(back);

            requestTarget(
                result.url,
                function (html) {
                    var media = parseMedia(result.url, html);

                    media.direct.forEach(function (stream, index) {
                        var item = row(
                            '▶ Прямий потік ' + (index + 1),
                            /\.m3u8(?:$|[?#])/i.test(stream.url)
                                ? 'HLS • Lampa.Player'
                                : 'MP4 • Lampa.Player'
                        );

                        item.on('hover:enter', function () {
                            playDirect(stream, object.movie || {});
                        });

                        self.append(item);
                    });

                    media.frames.forEach(function (frame, index) {
                        var item = row(
                            frame.title || ('Плеєр ' + (index + 1)),
                            'iframe'
                        );

                        item.on('hover:enter', function () {
                            Lampa.Activity.push({
                                url: '',
                                title: 'EX-FS',
                                component: FRAME_COMPONENT,
                                frame_url: frame.url,
                                movie: object.movie || {},
                                page: 1
                            });
                        });

                        self.append(item);
                    });

                    if (!media.direct.length && !media.frames.length) {
                        self.append(
                            row(
                                'Плеєри не знайдені',
                                'EX-FS не віддав публічний HLS/MP4 або iframe на цій сторінці'
                            )
                        );
                    }

                    self.activity.loader(false);
                    self.start(true);
                },
                function () {
                    self.empty('EX-FS: Worker не зміг відкрити сторінку фільму');
                }
            );
        };

        this.start = function (selectFirst) {
            if (Lampa.Activity.active().activity !== this.activity) return;

            if (selectFirst) {
                last = scroll.render().find('.selector').eq(0)[0] || null;
            }

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (typeof Navigator !== 'undefined' && Navigator.canmove('up')) {
                        Navigator.move('up');
                    } else {
                        Lampa.Controller.toggle('head');
                    }
                },
                down: function () {
                    if (typeof Navigator !== 'undefined') Navigator.move('down');
                },
                left: function () {
                    if (typeof Navigator !== 'undefined' && Navigator.canmove('left')) {
                        Navigator.move('left');
                    } else {
                        Lampa.Controller.toggle('menu');
                    }
                },
                right: function () {
                    if (typeof Navigator !== 'undefined' && Navigator.canmove('right')) {
                        Navigator.move('right');
                    }
                },
                back: this.back
            });

            Lampa.Controller.toggle('content');
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            try {
                scroll.destroy();
                files.destroy();
            } catch (e) {}
        };
    }

    function openExfs(movie) {
        if (!workerUrl()) {
            Lampa.Noty.show('EX-FS: Worker URL відсутній');
            return;
        }

        Lampa.Activity.push({
            url: '',
            title: 'EX-FS',
            component: COMPONENT,
            movie: movie,
            page: 1
        });
    }

    function addSettings() {
        if (!(Lampa.SettingsApi && Lampa.SettingsApi.addComponent && Lampa.SettingsApi.addParam)) {
            return;
        }

        try {
            Lampa.SettingsApi.addComponent({
                component: 'exfs_cloud',
                name: 'EX-FS',
                icon:
                    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
                        '<path d="M8 5v14l11-7z"></path>' +
                    '</svg>'
            });

            Lampa.SettingsApi.addParam({
                component: 'exfs_cloud',
                param: {
                    name: STORAGE_WORKER,
                    type: 'input',
                    default: ''
                },
                field: {
                    name: 'Cloudflare Worker URL',
                    description: 'Наприклад: https://exfs-proxy.xxxxx.workers.dev'
                }
            });
        } catch (e) {
            console.log('EX-FS settings error', e);
        }
    }

    function addButton(e) {
        var root = e.object.activity.render();

        if (!root || !root.length) return;
        if (root.find('.view--exfs-cloud').length) return;

        var button = $(
            '<div class="full-start__button selector view--exfs-cloud">' +
                '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M8 5v14l11-7z"></path>' +
                '</svg>' +
                '<span>EX-FS</span>' +
            '</div>'
        );

        button.on('hover:enter', function () {
            openExfs(e.data.movie);
        });

        var torrent = root.find('.view--torrent');

        if (torrent.length) torrent.after(button);
        else {
            var box = root.find('.full-start-new__buttons');
            if (!box.length) box = root.find('.full-start__buttons');
            if (box.length) box.prepend(button);
        }
    }

    function init() {
        if (
            !window.Lampa ||
            !Lampa.Component ||
            !Lampa.Activity ||
            !Lampa.Listener ||
            !Lampa.Controller ||
            !Lampa.Storage
        ) {
            setTimeout(init, 300);
            return;
        }

        if (window.__exfs_cloud_v12_started) return;

        try {
            Lampa.Component.add(COMPONENT, CloudComponent);
            Lampa.Component.add(FRAME_COMPONENT, FrameComponent);

            Lampa.Listener.follow('full', function (e) {
                if (e.type === 'complite') addButton(e);
            });

            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'EX-FS Cloud',
                description: 'EX-FS через Cloudflare Worker https://falling-sun-64c0.ana-pivot.workers.dev',
                component: COMPONENT
            };

            window.__exfs_cloud_v12_started = true;

            Lampa.Noty.show('EX-FS Cloud v' + VERSION + ' завантажено');
            setTimeout(checkWorkerHealth, 700);
        } catch (e) {
            console.log('EX-FS Cloud start error', e);
            setTimeout(init, 1000);
        }
    }

    if (window.appready) init();
    else if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
        setTimeout(init, 1200);
    } else {
        setTimeout(init, 500);
    }
})();
