/*!
 * EX-FS for Lampa
 * Version: 0.4.0
 *
 * Rewritten from scratch against the current Lampa plugin pattern.
 *
 * Features:
 * - EX-FS button on movie/series card
 * - Search on ex-fs.net
 * - Result list inside Lampa
 * - Public direct HLS/MP4 -> Lampa.Player
 * - Public iframe players -> internal iframe fallback
 *
 * No DRM/CAPTCHA/Cloudflare bypass and no extraction from protected
 * third-party embedded players.
 */
(function () {
    'use strict';

    var VERSION = '0.4.0';
    var DOMAIN = 'https://ex-fs.net';
    var COMPONENT = 'exfs_online_v4';
    var FRAME_COMPONENT = 'exfs_frame_v4';

    if (window.__exfs_v4_loaded) return;
    window.__exfs_v4_loaded = true;

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

    function absolute(url, base) {
        url = clean(url);
        base = base || DOMAIN + '/';

        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf('//') === 0) return 'https:' + url;

        try {
            var a = document.createElement('a');
            if (url.charAt(0) === '/') {
                a.href = DOMAIN + url;
            } else {
                var p = base.substring(0, base.lastIndexOf('/') + 1);
                a.href = p + url;
            }
            return a.href;
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

    function request(url, oncomplete, onerror, post, extra) {
        var network = new Lampa.Reguest();
        var options = extra || {};

        network.timeout(options.timeout || 15000);

        var params = {
            dataType: options.dataType || 'text',
            headers: options.headers || {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; TV) AppleWebKit/537.36 Chrome/150 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': DOMAIN + '/'
            }
        };

        /*
         * In current Lampa, native() uses Android native HTTP on Android
         * and falls back to the normal request path on other platforms.
         */
        network['native'](
            url,
            function (data) {
                if (typeof data !== 'string') {
                    if (data && typeof data.body === 'string') data = data.body;
                    else {
                        try { data = JSON.stringify(data); } catch (e) { data = ''; }
                    }
                }
                if (oncomplete) oncomplete(data || '');
            },
            function (a, b) {
                if (onerror) onerror(a, b, network);
            },
            post || false,
            params
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
            ) {
                return cur;
            }

            cur = cur.parentNode;
        }

        return node.parentNode || node;
    }

    function titleFromAnchor(a, container) {
        var value = clean(a.getAttribute('title'));

        if (!value) {
            var img = a.querySelector && a.querySelector('img[alt]');
            if (img) value = clean(img.getAttribute('alt'));
        }

        if (!value) value = clean(a.textContent);

        if ((!value || value.length < 2) && container && container.querySelector) {
            var h = container.querySelector(
                'h1,h2,h3,h4,.title,.name,.short-title,.shortstory__title,.th-title,.th-name,.movie-title'
            );
            if (h) value = clean(h.textContent);
        }

        value = value
            .replace(/\s*(смотреть|дивитися|watch)\s+онлайн.*$/i, '')
            .replace(/\s*онлайн\s*$/i, '')
            .trim();

        return value;
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

            /*
             * EX-FS has used both /film/ and /films/ over time.
             * Keep the matcher intentionally broad for its content sections.
             */
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
                var qparts = q.split(' ');
                var hits = 0;

                qparts.forEach(function (part) {
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
            if (b.score !== a.score) return b.score - a.score;
            if (wantedYear && a.year === String(wantedYear) && b.year !== String(wantedYear)) return -1;
            if (wantedYear && b.year === String(wantedYear) && a.year !== String(wantedYear)) return 1;
            return a.title.localeCompare(b.title);
        });

        return out.slice(0, 25);
    }

    function searchOnce(query, year, done, fail) {
        var getUrl =
            DOMAIN +
            '/index.php?do=search&subaction=search&story=' +
            encodeURIComponent(query);

        request(
            getUrl,
            function (html) {
                var items = parseSearch(html, query, year);

                if (items.length) {
                    done(items);
                    return;
                }

                /*
                 * DLE installations commonly use POST for the same search form,
                 * so retry by POST when GET returned no content items.
                 */
                var post =
                    'do=search' +
                    '&subaction=search' +
                    '&search_start=0' +
                    '&full_search=0' +
                    '&result_from=1' +
                    '&story=' + encodeURIComponent(query);

                request(
                    DOMAIN + '/index.php?do=search',
                    function (html2) {
                        done(parseSearch(html2, query, year));
                    },
                    fail,
                    post,
                    {
                        dataType: 'text',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; TV) AppleWebKit/537.36 Chrome/150 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'Referer': DOMAIN + '/'
                        }
                    }
                );
            },
            fail
        );
    }

    function searchMovie(movie, done, fail) {
        var title = movie.title || movie.name || '';
        var original = movie.original_title || movie.original_name || '';
        var date = movie.release_date || movie.first_air_date || movie.last_air_date || '';
        var year = (String(date).match(/^(19|20)\d{2}/) || [''])[0];

        if (!title && original) title = original;

        if (!title) {
            done([]);
            return;
        }

        searchOnce(
            title,
            year,
            function (items) {
                if (items.length || !original || normalize(original) === normalize(title)) {
                    done(items);
                    return;
                }

                searchOnce(original, year, done, fail);
            },
            fail
        );
    }

    function parseMedia(pageUrl, html) {
        var root = htmlRoot(html);
        var direct = [];
        var frames = [];
        var dseen = {};
        var fseen = {};

        function addDirect(url, title) {
            url = clean(url)
                .replace(/&amp;/g, '&')
                .replace(/\\\//g, '/');

            if (!url) return;
            url = absolute(url, pageUrl);

            if (!/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url)) return;
            if (dseen[url]) return;

            dseen[url] = true;
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
            if (fseen[url]) return;

            fseen[url] = true;
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

        Array.prototype.forEach.call(root.querySelectorAll('iframe[src]'), function (el) {
            addFrame(
                el.getAttribute('src'),
                el.getAttribute('title') || el.getAttribute('data-title')
            );
        });

        /*
         * Only direct URLs that are already publicly serialized in the EX-FS page.
         * Do not fetch embedded third-party player pages to extract hidden streams.
         */
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

    function playerTitle(movie, extra) {
        var base = movie.title || movie.name || movie.original_title || movie.original_name || 'EX-FS';
        return extra ? base + ' / ' + extra : base;
    }

    function playDirect(stream, movie) {
        var first = {
            url: stream.url,
            title: playerTitle(movie, stream.title)
        };

        try {
            if (movie.id) Lampa.Favorite.add('history', movie, 100);
        } catch (e) {}

        Lampa.Player.play(first);
        Lampa.Player.playlist([first]);
    }

    function openExternal(url) {
        try {
            if (Lampa.Platform.is('android') && Lampa.Android && Lampa.Android.openBrowser) {
                Lampa.Android.openBrowser(url);
                return;
            }
        } catch (e) {}

        try {
            window.open(url, '_blank');
        } catch (e2) {
            try { window.location.href = url; } catch (e3) {}
        }
    }

    function frameComponent(object) {
        var html = $('<div class="exfs-frame"></div>');
        var iframe = null;
        var self = this;

        this.create = function () {
            html.css({
                position: 'fixed',
                left: '0',
                top: '0',
                width: '100%',
                height: '100%',
                zIndex: '9999',
                background: '#000'
            });

            iframe = $('<iframe></iframe>');

            iframe.attr({
                src: object.frame_url,
                allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
                allowfullscreen: 'true',
                referrerpolicy: 'origin-when-cross-origin'
            });

            iframe.css({
                width: '100%',
                height: '100%',
                border: '0',
                background: '#000'
            });

            html.append(iframe);

            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add('exfs_frame', {
                toggle: function () {
                    try {
                        if (iframe && iframe[0]) iframe[0].focus();
                    } catch (e) {}
                },
                up: function () {},
                down: function () {},
                left: function () {},
                right: function () {},
                back: this.back
            });

            Lampa.Controller.toggle('exfs_frame');

            setTimeout(function () {
                try {
                    if (iframe && iframe[0]) iframe[0].focus();
                } catch (e) {}
            }, 300);
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            try {
                if (iframe) {
                    iframe.attr('src', 'about:blank');
                    iframe.remove();
                }
                html.remove();
            } catch (e) {}

            iframe = null;
            html = null;
        };
    }

    function openFrame(frame, movie) {
        Lampa.Activity.push({
            url: '',
            title: playerTitle(movie, frame.title),
            component: FRAME_COMPONENT,
            frame_url: frame.url,
            movie: movie,
            page: 1
        });
    }

    function row(title, subtitle) {
        return $(
            '<div class="online selector">' +
                '<div class="online__title">' + esc(title) + '</div>' +
                '<div class="online__quality">' + esc(subtitle || '') + '</div>' +
            '</div>'
        );
    }

    function component(object) {
        var self = this;
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({
            mask: true,
            over: true
        });
        var files = new Lampa.Explorer(object);
        var last = null;
        var searchResults = [];

        scroll.body().addClass('torrent-list');
        scroll.minus(files.render().find('.explorer__files-head'));

        this.create = function () {
            this.activity.loader(true);
            files.appendFiles(scroll.render());
            this.search();
            return this.render();
        };

        this.reset = function () {
            last = null;
            scroll.render().find('.empty').remove();
            scroll.clear();
            scroll.reset();
        };

        this.loading = function (status) {
            this.activity.loader(!!status);
        };

        this.empty = function (message) {
            this.reset();

            var empty = Lampa.Template.get('list_empty');
            if (message) empty.find('.empty__descr').text(message);

            scroll.append(empty);
            this.loading(false);
            this.start(false);
        };

        this.append = function (item) {
            item.on('hover:focus', function (e) {
                last = e.target;
                scroll.update($(e.target), true);
            });

            scroll.append(item);
        };

        this.showSearchResults = function (items) {
            searchResults = items || [];
            this.reset();

            if (!searchResults.length) {
                this.empty('EX-FS: нічого не знайдено');
                return;
            }

            searchResults.forEach(function (item) {
                var subtitle = 'EX-FS' + (item.year ? ' • ' + item.year : '');
                var card = row(item.title, subtitle);

                card.on('hover:enter', function () {
                    self.openPage(item);
                });

                self.append(card);
            });

            this.loading(false);
            this.start(true);
        };

        this.search = function () {
            this.loading(true);

            searchMovie(
                object.movie || {},
                function (items) {
                    self.showSearchResults(items);
                },
                function (a, b, req) {
                    var msg = 'EX-FS: помилка мережі';

                    try {
                        msg += ' — ' + req.errorDecode(a, b);
                    } catch (e) {}

                    self.empty(msg);
                }
            );
        };

        this.openPage = function (result) {
            this.loading(true);
            this.reset();

            network.clear();
            network.timeout(15000);

            network['native'](
                result.url,
                function (html) {
                    if (typeof html !== 'string') {
                        if (html && typeof html.body === 'string') html = html.body;
                        else html = String(html || '');
                    }

                    var media = parseMedia(result.url, html);

                    var back = row('← Назад до результатів', result.title);
                    back.on('hover:enter', function () {
                        self.showSearchResults(searchResults);
                    });
                    self.append(back);

                    if (media.direct.length) {
                        media.direct.forEach(function (stream, index) {
                            var kind = /\.m3u8(?:$|[?#])/i.test(stream.url) ? 'HLS' : 'MP4';
                            var item = row(
                                '▶ Прямий потік ' + (index + 1),
                                kind + ' • Lampa.Player'
                            );

                            item.on('hover:enter', function () {
                                playDirect(stream, object.movie || {});
                            });

                            self.append(item);
                        });
                    }

                    media.frames.forEach(function (frame, index) {
                        var item = row(
                            frame.title || ('Плеєр ' + (index + 1)),
                            'EX-FS • iframe'
                        );

                        item.on('hover:enter', function () {
                            openFrame(frame, object.movie || {});
                        });

                        self.append(item);
                    });

                    var external = row('Відкрити сторінку EX-FS', result.url);
                    external.on('hover:enter', function () {
                        openExternal(result.url);
                    });
                    self.append(external);

                    if (!media.direct.length && !media.frames.length) {
                        var no = row(
                            'Плеєри не знайдені',
                            'На сторінці немає публічного прямого потоку або iframe'
                        );
                        self.append(no);
                    } else if (!media.direct.length && media.frames.length) {
                        var info = row(
                            'Прямого HLS/MP4 немає',
                            'EX-FS віддає цю сторінку через iframe-плеєри'
                        );
                        self.append(info);
                    }

                    self.loading(false);
                    self.start(true);
                },
                function (a, b) {
                    var msg = 'EX-FS: не вдалося відкрити сторінку';

                    try {
                        msg += ' — ' + network.errorDecode(a, b);
                    } catch (e) {}

                    self.empty(msg);
                },
                false,
                {
                    dataType: 'text',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; TV) AppleWebKit/537.36 Chrome/150 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Referer': DOMAIN + '/'
                    }
                }
            );
        };

        this.start = function (firstSelect) {
            if (Lampa.Activity.active().activity !== this.activity) return;

            if (firstSelect) {
                last = scroll.render().find('.selector').eq(0)[0] || null;
            }

            try {
                Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            } catch (e) {}

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
                right: function () {
                    if (typeof Navigator !== 'undefined' && Navigator.canmove('right')) {
                        Navigator.move('right');
                    }
                },
                left: function () {
                    if (typeof Navigator !== 'undefined' && Navigator.canmove('left')) {
                        Navigator.move('left');
                    } else {
                        Lampa.Controller.toggle('menu');
                    }
                },
                back: this.back
            });

            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return files.render();
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            try { network.clear(); } catch (e) {}
            try { files.destroy(); } catch (e2) {}
            try { scroll.destroy(); } catch (e3) {}

            network = null;
            files = null;
            scroll = null;
        };
    }

    function loadOnline(movie) {
        Lampa.Component.add(COMPONENT, component);

        Lampa.Activity.push({
            url: '',
            title: 'EX-FS',
            component: COMPONENT,
            search: movie.title || movie.name || '',
            search_one: movie.title || movie.name || '',
            search_two: movie.original_title || movie.original_name || '',
            movie: movie,
            page: 1
        });
    }

    function initMain() {
        Lampa.Component.add(COMPONENT, component);
        Lampa.Component.add(FRAME_COMPONENT, frameComponent);

        var manifest = {
            type: 'video',
            version: VERSION,
            name: 'EX-FS - ' + VERSION,
            description: 'Перегляд EX-FS у Lampa',
            component: COMPONENT,
            onContextMenu: function () {
                return {
                    name: 'EX-FS',
                    description: ''
                };
            },
            onContextLauch: function (object) {
                loadOnline(object);
            }
        };

        Lampa.Manifest.plugins = manifest;

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var root = e.object.activity.render();
            if (root.find('.view--exfs').length) return;

            var button = $(
                '<div class="full-start__button selector view--exfs" data-subtitle="EX-FS ' + VERSION + '">' +
                    '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">' +
                        '<path d="M8 5v14l11-7z"></path>' +
                    '</svg>' +
                    '<span>EX-FS</span>' +
                '</div>'
            );

            button.on('hover:enter', function () {
                loadOnline(e.data.movie);
            });

            var torrent = root.find('.view--torrent');

            if (torrent.length) {
                torrent.after(button);
            } else {
                var buttons = root.find('.full-start-new__buttons');
                if (!buttons.length) buttons = root.find('.full-start__buttons');
                if (buttons.length) buttons.prepend(button);
            }
        });
    }

    function startPlugin() {
        if (!window.Lampa || !Lampa.Component || !Lampa.Activity || !Lampa.Reguest) {
            setTimeout(startPlugin, 250);
            return;
        }

        if (window.__exfs_v4_started) return;
        window.__exfs_v4_started = true;

        try {
            initMain();
            console.log('EX-FS', 'v' + VERSION + ' started');

            try {
                Lampa.Noty.show('EX-FS v' + VERSION + ' завантажено');
            } catch (e) {}
        } catch (e) {
            console.log('EX-FS start error', e);

            try {
                Lampa.Noty.show('EX-FS: помилка запуску — ' + (e.message || e));
            } catch (x) {}
        }
    }

    startPlugin();
})();
