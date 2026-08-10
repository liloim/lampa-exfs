/*!
 * EX-FS plugin for Lampa
 * Version: 0.2.0
 *
 * What it does:
 * - Adds an "EX-FS" button to movie/series cards
 * - Searches ex-fs.net using the public site search
 * - Opens publicly exposed player iframes inside Lampa
 *
 * What it does NOT do:
 * - No DRM/Cloudflare/CAPTCHA bypass
 * - No deobfuscation or extraction of protected direct stream URLs
 */

(function () {
    'use strict';

    if (window.exfs_plugin_ready) return;
    window.exfs_plugin_ready = true;

    var manifest = {
        type: 'video',
        version: '0.2.0',
        name: 'EX-FS',
        description: 'EX-FS public direct-stream and iframe integration for Lampa',
        component: 'exfs_online'
    };

    var STORAGE = {
        domain: 'exfs_domain',
        proxy: 'exfs_proxy'
    };

    function ensureDefaults() {
        var defaults = {};
        defaults[STORAGE.domain] = 'https://ex-fs.net';
        defaults[STORAGE.proxy] = '';

        Object.keys(defaults).forEach(function (key) {
            try {
                var cur = Lampa.Storage.get(key, '__none__');
                if (cur === '__none__' || cur === null || cur === undefined) {
                    Lampa.Storage.set(key, defaults[key]);
                }
            } catch (e) {}
        });
    }

    function getDomain() {
        var d = (Lampa.Storage.get(STORAGE.domain) || 'https://ex-fs.net').trim();
        if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
        return d.replace(/\/+$/, '');
    }

    function proxify(url) {
        var p = (Lampa.Storage.get(STORAGE.proxy) || '').trim();
        if (!p) return url;

        // Generic prefix proxy:
        // https://proxy.example/fetch?url=
        if (p.indexOf('{url}') >= 0) {
            return p.replace('{url}', encodeURIComponent(url));
        }

        // Simple path proxy:
        // https://proxy.example/
        if (p.slice(-1) !== '/') p += '/';
        return p + url;
    }

    function absoluteUrl(url) {
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf('//') === 0) return 'https:' + url;
        if (url.charAt(0) === '/') return getDomain() + url;
        return getDomain() + '/' + url;
    }

    function request(url, success, error, post) {
        var network = new Lampa.Reguest();
        network.timeout(20000);

        network.silent(
            proxify(url),
            function (response) {
                success(response);
            },
            function (a, b) {
                if (error) error(a, b);
            },
            post || false,
            {
                dataType: 'text',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'uk,ru;q=0.9,en;q=0.8',
                    'Referer': getDomain() + '/'
                }
            }
        );

        return network;
    }

    function parseHtml(html) {
        var root = document.createElement('div');
        root.innerHTML = html || '';
        return root;
    }

    function cleanTitle(s) {
        return (s || '')
            .replace(/\s+/g, ' ')
            .replace(/\s*(смотреть|дивитися)\s+онлайн.*$/i, '')
            .trim();
    }

    function searchExfs(query, year, callback) {
        // EX-FS is DLE-based. Public DLE search POST.
        var url = getDomain() + '/index.php?do=search';
        var post =
            'do=search' +
            '&subaction=search' +
            '&search_start=0' +
            '&full_search=0' +
            '&result_from=1' +
            '&story=' + encodeURIComponent(query);

        request(url, function (html) {
            var root = parseHtml(html);
            var found = [];
            var seen = {};

            var anchors = root.querySelectorAll('a[href]');
            Array.prototype.forEach.call(anchors, function (a) {
                var href = a.getAttribute('href') || '';

                if (!/(\/film\/|\/serials\/|\/multfilm\/|\/multserial\/|\/tv-show\/|\/show\/)/i.test(href)) {
                    return;
                }

                href = absoluteUrl(href);
                if (seen[href]) return;

                var title = cleanTitle(a.textContent || a.getAttribute('title') || '');
                if (!title || title.length < 2) return;

                var parent = a.parentNode;
                var text = '';
                for (var i = 0; i < 4 && parent; i++, parent = parent.parentNode) {
                    text += ' ' + (parent.textContent || '');
                }

                var ym = text.match(/\b(19|20)\d{2}\b/);
                var itemYear = ym ? ym[0] : '';

                seen[href] = true;
                found.push({
                    url: href,
                    title: title,
                    year: itemYear
                });
            });

            if (year) {
                var exact = found.filter(function (item) {
                    return String(item.year) === String(year);
                });

                if (exact.length) {
                    callback(exact);
                    return;
                }
            }

            callback(found);
        }, function () {
            callback([]);
        }, post);
    }


    function findDirectMedia(pageUrl, html) {
        var root = parseHtml(html);
        var out = [];
        var seen = {};

        function add(url, title) {
            if (!url) return;

            url = String(url)
                .replace(/&amp;/g, '&')
                .replace(/\\\//g, '/')
                .trim();

            if (!/^https?:\/\//i.test(url)) {
                url = absoluteUrl(url);
            }

            // Only direct media URLs publicly present in EX-FS page HTML.
            // We do NOT fetch embedded third-party player pages to extract streams.
            if (!/\.(m3u8|mp4)(?:$|[?#])/i.test(url)) return;
            if (seen[url]) return;

            seen[url] = true;

            out.push({
                title: title || (/\.m3u8(?:$|[?#])/i.test(url) ? 'HLS' : 'MP4'),
                url: url,
                page: pageUrl
            });
        }

        // Public DOM attributes on the EX-FS page itself.
        var attrs = ['src', 'href', 'data-src', 'data-file', 'data-url', 'data-video', 'data-stream'];

        Array.prototype.forEach.call(root.querySelectorAll('*'), function (el) {
            attrs.forEach(function (attr) {
                var value = el.getAttribute && el.getAttribute(attr);
                if (value) add(value, el.getAttribute('title') || '');
            });
        });

        // Public media URLs serialized directly in EX-FS page HTML/inline JSON.
        var text = html || '';
        var rx = /https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:m3u8|mp4)(?:\?[^"'<>\\\s]*)?/ig;
        var match;

        while ((match = rx.exec(text))) {
            add(match[0], '');
        }

        return out;
    }

    function playDirect(media, movie, playlist) {
        var item = {
            url: media.url,
            title: (movie.title || movie.name || 'EX-FS'),
            isonline: true
        };

        if (/\.m3u8(?:$|[?#])/i.test(media.url)) {
            item.hls = true;
        }

        var list = (playlist && playlist.length ? playlist : [media]).map(function (x) {
            return {
                url: x.url,
                title: x.title || movie.title || movie.name || 'EX-FS',
                isonline: true,
                hls: /\.m3u8(?:$|[?#])/i.test(x.url)
            };
        });

        try {
            Lampa.Player.play(item);
            Lampa.Player.playlist(list);
        } catch (e) {
            console.log('EX-FS direct play error', e);
            try {
                Lampa.Noty.show('EX-FS: не вдалося запустити прямий потік');
            } catch (x) {}
        }
    }

    function parsePlayers(pageUrl, html) {
        var root = parseHtml(html);
        var players = [];
        var seen = {};

        var frames = root.querySelectorAll('iframe[src]');

        Array.prototype.forEach.call(frames, function (frame, index) {
            var src = frame.getAttribute('src') || '';
            if (!src) return;

            src = absoluteUrl(src);

            // Trailer is not an online movie source.
            if (/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(src)) return;

            if (seen[src]) return;
            seen[src] = true;

            var title =
                frame.getAttribute('title') ||
                frame.getAttribute('data-title') ||
                ('Плеєр ' + (players.length + 1));

            players.push({
                title: title,
                url: src,
                page: pageUrl
            });
        });

        return players;
    }

    function fetchMedia(url, success, error) {
        request(url, function (html) {
            var direct = findDirectMedia(url, html);
            var frames = parsePlayers(url, html);

            if (!direct.length && !frames.length) {
                if (error) error('На сторінці EX-FS не знайдено публічних потоків або iframe-плеєрів');
                return;
            }

            success({
                direct: direct,
                frames: frames
            });
        }, function () {
            if (error) error('Не вдалося завантажити сторінку EX-FS');
        });
    }

    /* ----------------------------------------------------
     * Fullscreen iframe component
     * ---------------------------------------------------- */

    function iframeComponent(object) {
        var self = this;
        var html = $('<div></div>');
        var frame = null;

        this.create = function () {
            html.css({
                position: 'fixed',
                left: '0',
                top: '0',
                right: '0',
                bottom: '0',
                width: '100%',
                height: '100%',
                background: '#000',
                zIndex: '9999'
            });

            frame = $('<iframe></iframe>');

            frame.attr({
                src: object.url,
                allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
                allowfullscreen: 'true',
                referrerpolicy: 'no-referrer-when-downgrade'
            });

            frame.css({
                width: '100%',
                height: '100%',
                border: '0',
                background: '#000'
            });

            html.append(frame);

            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add('exfs_iframe', {
                toggle: function () {},
                up: function () {},
                down: function () {},
                left: function () {},
                right: function () {},
                back: self.back
            });

            Lampa.Controller.toggle('exfs_iframe');

            // Try focusing iframe so Android TV/WebView can forward keys.
            setTimeout(function () {
                try {
                    frame && frame[0] && frame[0].focus();
                } catch (e) {}
            }, 300);
        };

        this.pause = function () {};

        this.stop = function () {};

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.destroy = function () {
            try {
                if (frame) {
                    frame.attr('src', 'about:blank');
                    frame.remove();
                }
                html.remove();
            } catch (e) {}
        };
    }

    function openIframe(player, movie) {
        Lampa.Activity.push({
            url: '',
            title: 'EX-FS - ' + (movie.title || movie.name || ''),
            component: 'exfs_iframe',
            movie: movie,
            player: player,
            page: 1,
            url_player: player.url,
            // iframeComponent reads object.url below:
            url: player.url
        });
    }

    /* ----------------------------------------------------
     * EX-FS result component
     * ---------------------------------------------------- */

    function component(object) {
        var self = this;
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var html = $('<div></div>');
        var filter = new Lampa.Filter(object);

        this.create = function () {
            scroll.minus();
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            return this.render();
        };

        this.render = function () {
            return files.render();
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;

            try {
                Lampa.Background.immediately(
                    Lampa.Utils.cardImgBackgroundBlur(object.movie)
                );
            } catch (e) {}

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
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
                    Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (typeof Navigator !== 'undefined') Navigator.move('right');
                },
                back: this.back
            });

            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};

        this.stop = function () {};

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.destroy = function () {
            try { network.clear(); } catch (e) {}
            try { scroll.destroy(); } catch (e) {}
            try { files.destroy(); } catch (e) {}
            try { filter.destroy(); } catch (e) {}
            try { html.remove(); } catch (e) {}
        };

        function clear() {
            html.empty();
        }

        function showError(text) {
            clear();
            var empty = new Lampa.Empty({ text: text });
            html.append(empty.render());
            scroll.append(html);
        }

        function addRow(title, subtitle, enter) {
            var item = $(
                '<div class="online selector">' +
                    '<div class="online__title">' + Lampa.Utils.escape(title) + '</div>' +
                    '<div class="online__quality">' + Lampa.Utils.escape(subtitle || '') + '</div>' +
                '</div>'
            );

            item.on('hover:enter', enter);
            html.append(item);
        }

        function showPlayers(result) {
            clear();

            addRow(
                'Відкрити сторінку EX-FS',
                result.url,
                function () {
                    // Fallback for providers that block iframe embedding.
                    try {
                        var w = window.open(result.url, '_blank');
                        if (!w) window.location.href = result.url;
                    } catch (e) {
                        window.location.href = result.url;
                    }
                }
            );

            fetchMedia(result.url, function (media) {
                var movie = object.movie || {};

                if (media.direct.length) {
                    media.direct.forEach(function (stream, index) {
                        addRow(
                            '▶ Прямий потік ' + (index + 1),
                            (/\.m3u8(?:$|[?#])/i.test(stream.url) ? 'HLS • штатний Lampa.Player' : 'MP4 • штатний Lampa.Player'),
                            function () {
                                playDirect(stream, movie, media.direct);
                            }
                        );
                    });
                }

                media.frames.forEach(function (player, index) {
                    addRow(
                        'Плеєр ' + (index + 1) + ' (iframe)',
                        player.url.replace(/^https?:\/\//, ''),
                        function () {
                            openIframe(player, movie);
                        }
                    );
                });

                if (!media.direct.length && media.frames.length) {
                    addRow(
                        'Прямого потоку немає',
                        'EX-FS віддає лише iframe; штатний Lampa.Player тут недоступний',
                        function () {}
                    );
                }

                scroll.append(html);
                self.activity.loader(false);
                self.activity.toggle();
                Lampa.Controller.enable('content');
            }, function (msg) {
                addRow('Плеєри не знайдені', msg, function () {});
                scroll.append(html);
                self.activity.loader(false);
                self.activity.toggle();
                Lampa.Controller.enable('content');
            });
        }

        function showResults(results) {
            clear();

            if (!results.length) {
                showError('EX-FS: нічого не знайдено');
                self.activity.loader(false);
                self.activity.toggle();
                return;
            }

            results.slice(0, 15).forEach(function (result) {
                addRow(
                    result.title,
                    result.year ? ('EX-FS • ' + result.year) : 'EX-FS',
                    function () {
                        self.activity.loader(true);
                        showPlayers(result);
                    }
                );
            });

            scroll.append(html);
            self.activity.loader(false);
            self.activity.toggle();
            Lampa.Controller.enable('content');
        }

        this.initialize = function () {
            this.activity.loader(true);

            var movie = object.movie || {};
            var title = movie.title || movie.name || movie.original_title || '';
            var year =
                (movie.release_date || movie.first_air_date || '').slice(0, 4);

            if (!title) {
                showError('EX-FS: немає назви для пошуку');
                this.activity.loader(false);
                this.activity.toggle();
                return;
            }

            searchExfs(title, year, showResults);
        };
    }

    function openExfs(movie) {
        Lampa.Activity.push({
            url: '',
            title: 'EX-FS - ' + (movie.title || movie.name || ''),
            component: 'exfs_online',
            movie: movie,
            page: 1
        });
    }

    function registerComponent() {
        if (Lampa.Component && Lampa.Component.add) {
            Lampa.Component.add('exfs_online', component);
            Lampa.Component.add('exfs_iframe', iframeComponent);
        }
    }

    function addOnlineSource() {
        if (!(Lampa.Online && Lampa.Online.register)) return;

        Lampa.Online.register('exfs', {
            title: 'EX-FS',
            search: function (movie, oncomplete) {
                openExfs(movie);
                if (oncomplete) oncomplete([]);
            },
            onContextMenu: function () {
                return { name: 'EX-FS' };
            }
        });
    }

    function addCardButton() {
        var styleId = 'exfs-plugin-style';

        if (!document.getElementById(styleId)) {
            var st = document.createElement('style');
            st.id = styleId;
            st.innerHTML =
                '.full-start__button.view--exfs{' +
                    'background:#202020;' +
                    'color:#fff' +
                '}' +
                '.view--exfs .button__icon{margin-right:.4em}';
            document.head.appendChild(st);
        }

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var root = e.object.activity.render();
            var box = root.find('.full-start-new__buttons');

            if (!box.length) box = root.find('.full-start__buttons');
            if (!box.length) return;
            if (root.find('.view--exfs').length) return;

            var label =
                '<svg class="button__icon" width="22" height="22" viewBox="0 0 24 24" fill="none">' +
                    '<path d="M8 5v14l11-7z" fill="currentColor"/>' +
                '</svg>' +
                '<span>EX-FS</span>';

            var button = $(
                '<div class="full-start__button selector view--online view--exfs">' +
                    label +
                '</div>'
            );

            button.on('hover:enter', function () {
                openExfs(e.data.movie);
            });

            box.prepend(button);
        });
    }

    function addSettings() {
        if (!(Lampa.SettingsApi && Lampa.SettingsApi.addComponent)) return;

        Lampa.SettingsApi.addComponent({
            component: 'exfs',
            name: 'EX-FS',
            icon:
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
                    '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M10 8l6 4-6 4V8z" fill="currentColor"/>' +
                '</svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'exfs',
            param: {
                name: STORAGE.domain,
                type: 'input',
                values: '',
                default: 'https://ex-fs.net'
            },
            field: {
                name: 'Домен EX-FS',
                description: 'Основний домен сайту'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'exfs',
            param: {
                name: STORAGE.proxy,
                type: 'input',
                values: '',
                default: ''
            },
            field: {
                name: 'CORS-проксі',
                description:
                    'Необов’язково. Можна вказати https://proxy.example/{url} або https://proxy.example/'
            }
        });
    }

    function registerManifest() {
        try {
            if (!Lampa.Manifest) Lampa.Manifest = {};

            if (Array.isArray(Lampa.Manifest.plugins)) {
                var exists = Lampa.Manifest.plugins.some(function (p) {
                    return p && p.component === manifest.component;
                });

                if (!exists) Lampa.Manifest.plugins.push(manifest);
            } else if (
                typeof Lampa.Manifest.plugins === 'object' &&
                Lampa.Manifest.plugins
            ) {
                Lampa.Manifest.plugins[manifest.component] = manifest;
            } else {
                var box = {};
                box[manifest.component] = manifest;
                Lampa.Manifest.plugins = box;
            }
        } catch (e) {}
    }

    function startPlugin() {
        if (window.exfs_plugin_started) return;
        window.exfs_plugin_started = true;

        try {
            ensureDefaults();
            registerManifest();
            registerComponent();
            addSettings();
            addOnlineSource();
            addCardButton();

            console.log('EX-FS', 'plugin started');
        } catch (e) {
            console.log('EX-FS start error', e);
            try {
                Lampa.Noty.show('EX-FS: помилка запуску — ' + e.message);
            } catch (x) {}
        }
    }

    function bootstrap() {
        if (typeof Lampa === 'undefined') {
            setTimeout(bootstrap, 200);
            return;
        }

        if (window.appready) {
            startPlugin();
        } else if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') startPlugin();
            });

            setTimeout(function () {
                if (window.appready) startPlugin();
            }, 1000);
        } else {
            startPlugin();
        }
    }

    bootstrap();
})();
