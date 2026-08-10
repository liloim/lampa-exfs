/*!
 * EX-FS for Lampa
 * Version: 1.0.0
 *
 * Proxy-free edition:
 * - adds EX-FS button to movie/series card
 * - opens EX-FS search page directly inside Lampa in an iframe
 * - no HTML parsing
 * - no CORS proxy
 * - no external backend
 */

(function () {
    'use strict';

    var VERSION = '1.0.0';
    var DOMAIN = 'https://ex-fs.net';
    var COMPONENT = 'exfs_web_v1';

    if (window.__exfs_web_v1_loaded) return;
    window.__exfs_web_v1_loaded = true;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function movieTitle(movie) {
        return (
            movie.title ||
            movie.name ||
            movie.original_title ||
            movie.original_name ||
            ''
        ).trim();
    }

    function searchUrl(movie) {
        var title = movieTitle(movie);

        return DOMAIN +
            '/index.php?do=search&subaction=search&story=' +
            encodeURIComponent(title);
    }

    function openExternal(url) {
        try {
            if (
                Lampa.Platform &&
                Lampa.Platform.is &&
                Lampa.Platform.is('android') &&
                Lampa.Android &&
                Lampa.Android.openBrowser
            ) {
                Lampa.Android.openBrowser(url);
                return;
            }
        } catch (e) {}

        try {
            window.open(url, '_blank');
        } catch (e2) {
            try {
                window.location.href = url;
            } catch (e3) {}
        }
    }

    function WebComponent(object) {
        var self = this;
        var html = $('<div class="exfs-web"></div>');
        var frame = null;
        var toolbar = null;
        var frameWrap = null;

        function createToolbar() {
            toolbar = $(
                '<div class="exfs-web__toolbar">' +
                    '<div class="exfs-web__title">EX-FS</div>' +
                    '<div class="exfs-web__actions">' +
                        '<div class="exfs-web__button selector exfs-web__reload">Оновити</div>' +
                        '<div class="exfs-web__button selector exfs-web__external">Відкрити окремо</div>' +
                        '<div class="exfs-web__button selector exfs-web__close">Назад</div>' +
                    '</div>' +
                '</div>'
            );

            toolbar.find('.exfs-web__reload').on('hover:enter', function () {
                try {
                    frame.attr('src', 'about:blank');

                    setTimeout(function () {
                        frame.attr('src', object.exfs_url);
                    }, 50);
                } catch (e) {}
            });

            toolbar.find('.exfs-web__external').on('hover:enter', function () {
                openExternal(object.exfs_url);
            });

            toolbar.find('.exfs-web__close').on('hover:enter', function () {
                self.back();
            });

            return toolbar;
        }

        this.create = function () {
            html.css({
                position: 'fixed',
                left: '0',
                top: '0',
                width: '100%',
                height: '100%',
                background: '#111',
                zIndex: '9999',
                display: 'flex',
                flexDirection: 'column'
            });

            createToolbar();

            toolbar.css({
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1em',
                padding: '0.7em 1em',
                background: 'rgba(15,15,15,.96)',
                color: '#fff',
                zIndex: '2'
            });

            toolbar.find('.exfs-web__title').css({
                fontSize: '1.2em',
                fontWeight: '600'
            });

            toolbar.find('.exfs-web__actions').css({
                display: 'flex',
                alignItems: 'center',
                gap: '0.6em'
            });

            toolbar.find('.exfs-web__button').css({
                padding: '0.45em 0.8em',
                borderRadius: '0.4em',
                background: 'rgba(255,255,255,.12)',
                whiteSpace: 'nowrap'
            });

            frameWrap = $('<div class="exfs-web__frame-wrap"></div>');
            frameWrap.css({
                position: 'relative',
                flex: '1 1 auto',
                minHeight: '0',
                background: '#000'
            });

            frame = $('<iframe class="exfs-web__frame"></iframe>');

            frame.attr({
                src: object.exfs_url,
                allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
                allowfullscreen: 'true',
                referrerpolicy: 'strict-origin-when-cross-origin'
            });

            frame.css({
                display: 'block',
                width: '100%',
                height: '100%',
                border: '0',
                background: '#000'
            });

            frame.on('load', function () {
                try {
                    console.log('EX-FS iframe loaded:', object.exfs_url);
                } catch (e) {}
            });

            frameWrap.append(frame);
            html.append(toolbar);
            html.append(frameWrap);

            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add('exfs_web_v1', {
                toggle: function () {
                    /*
                     * First focus toolbar so Back always works in Lampa.
                     * User can then enter iframe with Down.
                     */
                    try {
                        Lampa.Controller.collectionSet(
                            toolbar.find('.selector'),
                            toolbar
                        );
                        Lampa.Controller.collectionFocus(
                            toolbar.find('.selector').eq(0)[0],
                            toolbar
                        );
                    } catch (e) {}
                },

                up: function () {
                    try {
                        Lampa.Controller.collectionFocus(
                            toolbar.find('.selector').eq(0)[0],
                            toolbar
                        );
                    } catch (e) {}
                },

                down: function () {
                    try {
                        if (frame && frame[0]) frame[0].focus();
                    } catch (e) {}
                },

                left: function () {
                    try {
                        if (typeof Navigator !== 'undefined') Navigator.move('left');
                    } catch (e) {}
                },

                right: function () {
                    try {
                        if (typeof Navigator !== 'undefined') Navigator.move('right');
                    } catch (e) {}
                },

                back: this.back
            });

            Lampa.Controller.toggle('exfs_web_v1');

            setTimeout(function () {
                try {
                    if (frame && frame[0]) frame[0].focus();
                } catch (e) {}
            }, 700);
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            try {
                if (frame) {
                    frame.attr('src', 'about:blank');
                    frame.off();
                    frame.remove();
                }

                if (toolbar) {
                    toolbar.remove();
                }

                if (html) {
                    html.remove();
                }
            } catch (e) {}

            frame = null;
            toolbar = null;
            frameWrap = null;
            html = null;
        };
    }

    function openExfs(movie) {
        var title = movieTitle(movie);

        if (!title) {
            try {
                Lampa.Noty.show('EX-FS: немає назви для пошуку');
            } catch (e) {}

            return;
        }

        Lampa.Activity.push({
            url: '',
            title: 'EX-FS — ' + title,
            component: COMPONENT,
            movie: movie,
            exfs_url: searchUrl(movie),
            page: 1
        });
    }

    function addButton(e) {
        var root = e.object.activity.render();

        if (!root || !root.length) return;
        if (root.find('.view--exfs-web').length) return;

        var button = $(
            '<div class="full-start__button selector view--exfs-web" ' +
                'data-subtitle="EX-FS ' + VERSION + '">' +
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

        if (torrent.length) {
            torrent.after(button);
            return;
        }

        var online = root.find('.view--online').first();

        if (online.length) {
            online.after(button);
            return;
        }

        var box = root.find('.full-start-new__buttons');

        if (!box.length) box = root.find('.full-start__buttons');

        if (box.length) {
            box.prepend(button);
        }
    }

    function init() {
        if (
            !window.Lampa ||
            !Lampa.Component ||
            !Lampa.Activity ||
            !Lampa.Listener ||
            !Lampa.Controller
        ) {
            setTimeout(init, 300);
            return;
        }

        if (window.__exfs_web_v1_started) return;

        try {
            Lampa.Component.add(COMPONENT, WebComponent);

            Lampa.Listener.follow('full', function (e) {
                if (e.type === 'complite') addButton(e);
            });

            /*
             * Also add button if plugin loads while a movie card is already open.
             */
            try {
                var active = Lampa.Activity.active();

                if (active && active.component === 'full' && active.activity) {
                    addButton({
                        object: active,
                        data: {
                            movie: active.card || active.movie || {}
                        }
                    });
                }
            } catch (e) {}

            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'EX-FS',
                description: 'EX-FS web player without proxy',
                component: COMPONENT
            };

            window.__exfs_web_v1_started = true;

            console.log('EX-FS v' + VERSION + ' started');

            try {
                Lampa.Noty.show('EX-FS v' + VERSION + ' завантажено');
            } catch (e) {}
        } catch (e) {
            console.log('EX-FS start error', e);

            setTimeout(init, 1000);
        }
    }

    if (window.appready) {
        init();
    } else if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });

        setTimeout(init, 1200);
    } else {
        setTimeout(init, 500);
    }
})();
